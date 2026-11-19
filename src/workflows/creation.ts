import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PlannerOutputSchema, StoryPlannerOutputSchema, DraftPayloadSchema } from '../domain/planning.js';
import { ReviewSchema, ExtractionSchema, StoryChangesSchema } from '../domain/review.js';
import type { Review } from '../domain/review.js';
import { SelectionSchema } from '../domain/patch.js';
import type { AppConfig } from '../domain/model-config.js';
import { BookStore } from '../storage/book-store.js';
import { ProposalStore } from '../storage/proposal-store.js';
import { ReviewStore } from '../storage/review-store.js';
import { MemoryStore } from '../storage/memory-store.js';
import { RunStore } from '../storage/run-store.js';
import type { Budget, Run } from '../storage/run-store.js';
import { buildContext, ContextSchema } from '../context/builder.js';
import type { ContextSnapshot } from '../context/builder.js';
import { selectionContext } from '../context/selection.js';
import { blocks, validateReview, validateExtraction } from '../review/evidence.js';
import { prompt } from '../agents/prompts.js';
import { TrackedGateway } from '../llm/tracked-gateway.js';
import type { TextTransport } from '../llm/sdk-provider.js';
import { withRunLease } from './lease.js';
import type { WriteLease } from './lease.js';
import { activeStory, buildSceneContext, contextRevisionIds, writerForbidden, writerTextAllowed } from '../context/story-builder.js';
import { eventRelation } from '../domain/story-memory.js';
import { hash } from '../domain/workspace.js';

const ArtifactSchema = z.strictObject({ proposalId: z.string(), revisionId: z.string().optional() });
type Artifact = z.infer<typeof ArtifactSchema>;
const common = { configSource: z.string(), promptVersion: z.string() };
const PlanInput = z.strictObject({ ...common, brief: z.string().min(1), chapters: z.number().int().min(1).max(20), storyContext: z.unknown().optional() });
const ChapterInput = z.strictObject({ ...common, chapter: z.number().int().positive(), context: ContextSchema, sceneContexts: z.array(ContextSchema).optional(), reviewContext: ContextSchema.optional(), originalRevisionId: z.string().optional(), instruction: z.string().optional(), autoRevise: z.boolean().default(false) });
const ReviewInput = z.strictObject({ ...common, target: ArtifactSchema, context: ContextSchema });

export class CreationWorkflow {
  readonly runs: RunStore;
  readonly proposals: ProposalStore;
  readonly reports: ReviewStore;
  constructor(readonly book: BookStore, readonly config: AppConfig, readonly transport: TextTransport, readonly budget: Budget, readonly configSource = 'builtin') {
    this.runs = new RunStore(book); this.proposals = new ProposalStore(book); this.reports = new ReviewStore(book);
  }

  async plan(brief: string, chapters: number) {
    if (!brief.trim() || !Number.isSafeInteger(chapters) || chapters < 1 || chapters > 20) throw new Error('创作要求不能为空，每批计划支持 1～20 章。');
    const snapshot = this.book.snapshot();
    const storyContext = snapshot.state.story ? { story: activeStory(this.book, snapshot.version), plans: snapshot.state.plans, constraints: snapshot.state.constraints, chapters: snapshot.state.chapters.map(item => ({ ...item, content: this.book.revision(item.revisionId).content })) } : undefined;
    const input = PlanInput.parse({ brief, chapters, configSource: this.configSource, promptVersion: storyContext ? 'planner-story-v1' : 'planner-v1', ...(storyContext ? { storyContext } : {}) });
    return this.execute(this.runs.create('plan', input, this.config, this.budget, snapshot.version), false);
  }

  async draft(chapter: number) { return this.startChapter('draft', chapter); }
  async write(chapter: number, autoRevise = false) { return this.startChapter('write', chapter, { autoRevise }); }

  async revise(revisionId: string, instruction: string) {
    if (!instruction.trim()) throw new Error('修订要求不能为空。');
    const target = this.findCandidate(revisionId);
    if (this.proposals.get(target.proposalId).kind !== 'draft') throw new Error('部分采纳结果请重新分析修改组，不使用整章修订绕过选择。');
    const payload = DraftPayloadSchema.parse(this.proposals.get(target.proposalId).payload);
    const plan = this.book.snapshot().state.plans[payload.chapterId];
    if (!plan) throw new Error('找不到对应的已批准计划。');
    return this.startChapter('revise', plan.ordinal, { originalRevisionId: revisionId, instruction });
  }

  async review(revisionId: string) {
    const target = this.findCandidate(revisionId);
    const revision = this.book.revision(revisionId);
    const proposal = this.proposals.get(target.proposalId);
    const story = this.book.snapshot().state.story;
    const scene = story?.scenes.find(item => item.chapterId === revision.chapterId);
    const context: ContextSnapshot = proposal.kind === 'selection' ? selectionContext(this.book, proposal, revisionId) : scene ? buildSceneContext(this.book, scene.id, this.config, proposal.baseVersion, 'reviewer') : buildContext(this.book, revision.chapterId, this.config);
    const input = ReviewInput.parse({ target, context, configSource: this.configSource, promptVersion: context.protocolVersion ? 'reviewer-story-v1' : 'reviewer-v1' });
    return this.execute(this.runs.create('review', input, this.config, this.budget, context.projectVersion), false);
  }

  async resume(id: string, retryUnknown = false) {
    const run = this.runs.get(id);
    if (run.status === 'succeeded') return this.render(id, ArtifactSchema.parse(this.runs.artifact(id, 'result')));
    return this.execute(run, true, retryUnknown);
  }

  private async startChapter(kind: 'draft' | 'write' | 'revise', chapter: number, extra: { autoRevise?: boolean; originalRevisionId?: string; instruction?: string } = {}) {
    const context = buildContext(this.book, chapter, this.config);
    const scenes = this.book.snapshot(context.projectVersion).state.story?.scenes.filter(item => item.chapterId === context.plan.chapterId);
    const sceneContexts = scenes?.map(scene => buildSceneContext(this.book, scene.id, this.config, context.projectVersion));
    const reviewContext = scenes?.[0] ? buildSceneContext(this.book, scenes[0].id, this.config, context.projectVersion, 'reviewer') : undefined;
    const input = ChapterInput.parse({ chapter, context, ...(sceneContexts ? { sceneContexts, reviewContext } : {}), configSource: this.configSource, promptVersion: scenes ? 'writer-story-v1' : 'writer-v1', ...extra });
    if (this.book.snapshot().state.locks.some(lock => lock.chapterId === context.plan.chapterId)) throw new Error('本章存在锁定范围，请使用局部修改提案。');
    return this.execute(this.runs.create(kind, input, this.config, this.budget, context.projectVersion), false);
  }

  private findCandidate(revisionId: string): Artifact {
    const proposal = this.proposals.list().find(item => item.status === 'pending' && (item.kind === 'draft' ? DraftPayloadSchema.parse(item.payload).revisionId === revisionId : item.kind === 'selection' && SelectionSchema.parse(item.payload).drafts.some(draft => draft.revisionId === revisionId)));
    if (!proposal || proposal.baseVersion !== this.book.project().version) throw new Error('找不到基于当前项目版本的待批准候选。');
    if (this.runs.get(proposal.runId).cancelled) throw new Error('候选所属运行已取消。');
    return { proposalId: proposal.id, revisionId };
  }

  private render(runId: string, artifact: Artifact) {
    const revision = artifact.revisionId ? this.book.revision(artifact.revisionId) : undefined;
    const review = revision ? this.reports.latest('reviews', revision.id) : undefined;
    return { runId, proposal: this.proposals.get(artifact.proposalId), revision, review: review ? { ...review, payload: JSON.parse(review.payload) as unknown } : undefined };
  }

  private async execute(run: Run, recover: boolean, retryUnknown = false) {
    return withRunLease(this.runs, run.id, async lease => {
      const gateway = (step: string) => new TrackedGateway(this.runs, run.id, step, this.transport, retryUnknown, lease.assert);
      try {
        const existing = this.runs.artifact(run.id, 'result');
        if (existing !== undefined) return this.render(run.id, ArtifactSchema.parse(existing));
        let artifact: Artifact;
        if (run.kind === 'plan') {
          const input = PlanInput.parse(run.input);
          const result = await gateway(input.storyContext ? 'plan:story-v1' : 'plan:v1').generateObject({ prompt: `${prompt(input.storyContext ? 'planner-story-v1' : 'planner-v1')}\n章节数：${input.chapters}\n作者要求：${input.brief}${input.storyContext ? `\n当前故事：${JSON.stringify(input.storyContext)}` : ''}`, maxOutputTokens: run.config.model.maxOutputTokens, schema: input.storyContext ? StoryPlannerOutputSchema : PlannerOutputSchema });
          if (result.value.chapters.length !== input.chapters) throw new Error('模型计划数量不符合请求。');
          artifact = this.book.db.transaction(() => {
            lease.assert();
            const snapshot = this.book.snapshot(run.baseVersion);
            const offset = Math.max(snapshot.state.chapters.length, ...Object.values(snapshot.state.plans).map(item => item.ordinal), 0);
            const plans = result.value.chapters.map((content, index) => ({ ...content, chapterId: randomUUID(), revisionId: randomUUID(), ordinal: offset + index + 1 }));
            const proposal = this.proposals.create('plan', run.baseVersion, { plans }, run.id);
            const saved = { proposalId: proposal.id };
            this.runs.saveArtifact(run.id, 'result', saved); this.runs.status(run.id, 'awaiting_approval');
            return saved;
          }).immediate();
          return this.render(run.id, artifact);
        }
        if (run.kind === 'review') {
          const input = ReviewInput.parse(run.input); artifact = input.target;
          await this.audit(run, artifact, input.context, lease, gateway);
        } else if (['draft', 'write', 'revise'].includes(run.kind)) {
          const input = ChapterInput.parse(run.input);
          artifact = input.sceneContexts ? await this.generateScenes(run, 'draft', input, lease, gateway) : await this.generateCandidate(run, 'draft', input.context, lease, gateway, input.originalRevisionId, input.instruction);
          if (run.kind !== 'draft') {
            let review = await this.audit(run, artifact, input.reviewContext ?? input.context, lease, gateway);
            if (input.autoRevise && review.issues.length) {
              const original = artifact;
              artifact = input.sceneContexts ? await this.generateScenes(run, 'revision', { ...input, instruction: '按已批准场景重新生成，重新检查衔接与视角。' }, lease, gateway) : await this.generateCandidate(run, 'revision', input.context, lease, gateway, original.revisionId, JSON.stringify(review));
              review = await this.audit(run, artifact, input.reviewContext ?? input.context, lease, gateway);
              this.proposals.status(original.proposalId, 'superseded');
            }
          }
        } else throw new Error('此运行类型不能由创作工作流恢复。');
        this.book.db.transaction(() => {
          lease.assert(); this.runs.saveArtifact(run.id, 'result', artifact);
          this.runs.status(run.id, run.kind === 'review' ? 'succeeded' : 'awaiting_approval');
        }).immediate();
        return this.render(run.id, artifact);
      } catch (error) { lease.fail('workflow-failed'); throw error; }
    }, recover);
  }

  private async generateScenes(run: Run, step: string, input: z.infer<typeof ChapterInput>, lease: WriteLease, gateway: (name: string) => TrackedGateway): Promise<Artifact> {
    const saved = this.runs.artifact(run.id, step);
    if (saved !== undefined) return ArtifactSchema.parse(saved);
    const story = activeStory(this.book, run.baseVersion);
    const contexts = input.sceneContexts!;
    type SceneResult = { sceneId: string; runId: string; text: string; contentHash: string };
    const results: SceneResult[] = [];
    for (const context of contexts) {
      const scene = story.scenes.find(item => item.id === context.sceneId)!;
      if (input.instruction && !writerTextAllowed(input.instruction, writerForbidden(story, scene))) throw new Error('场景修订指令包含本视角不可用信息，请先编辑目标场景。');
    }
    for (const context of contexts) {
      const scene = story.scenes.find(item => item.id === context.sceneId)!;
      const key = `${step}:scene:${scene.id}`;
      const previous = this.runs.artifact(run.id, key) as SceneResult | undefined;
      if (previous) {
        if (previous.runId !== run.id || previous.sceneId !== scene.id || previous.contentHash !== hash(previous.text)) throw new Error('场景候选身份或内容校验失败。');
        results.push(previous); continue;
      }
      const continuation = results.filter(item => {
        const prior = story.scenes.find(candidate => candidate.id === item.sceneId)!;
        return prior.viewpointId === scene.viewpointId && prior.narration === scene.narration && ['before', 'equal'].includes(eventRelation(story, prior.eventId, scene.eventId)) && writerTextAllowed(item.text, writerForbidden(story, scene));
      });
      const inputKey = `context:${key}`;
      // Persist the exact input once, before any external request. Recovery reads it.
      let actual = this.runs.artifact(run.id, inputKey);
      if (actual === undefined) {
        const { omissions: _omissions, ...visible } = context;
        actual = { context: visible, continuation, instruction: input.instruction ?? '', omittedSceneIds: results.filter(item => !continuation.includes(item)).map(item => item.sceneId) };
        this.book.db.transaction(() => { lease.assert(); this.runs.saveArtifact(run.id, inputKey, actual); }).immediate();
      }
      const response = await gateway(key).generateText({ prompt: `${prompt('writer-story-v1')}\n${JSON.stringify(actual)}`, maxOutputTokens: run.config.model.maxOutputTokens });
      const text = response.value.replace(/^##[^\n]*(?:\n|$)/u, '').trim();
      if (!text) throw new Error('场景候选没有有效正文。');
      const result = { sceneId: scene.id, runId: run.id, text, contentHash: hash(text) };
      this.book.db.transaction(() => { lease.assert(); this.runs.saveArtifact(run.id, key, result); }).immediate(); results.push(result);
    }
    return this.book.db.transaction(() => {
      lease.assert(); let content = `## ${input.context.plan.title}\n\n`;
      const sceneRanges = results.map(item => { const start = content.length; content += `${item.text}\n\n`; return { sceneId: item.sceneId, start, end: start + item.text.length }; });
      const parent = input.originalRevisionId ?? this.book.snapshot(run.baseVersion).state.chapters.find(item => item.id === input.context.plan.chapterId)?.revisionId ?? null;
      const revision = this.book.insertRevision(input.context.plan.chapterId, content, parent, run.id);
      const proposal = this.proposals.create('draft', run.baseVersion, { chapterId: revision.chapterId, revisionId: revision.id, planRevisionId: input.context.plan.revisionId, contentHash: revision.contentHash, sceneRanges }, run.id);
      const artifact = { proposalId: proposal.id, revisionId: revision.id }; this.runs.saveArtifact(run.id, step, artifact); return artifact;
    }).immediate();
  }

  private async generateCandidate(run: Run, step: string, context: ContextSnapshot, lease: WriteLease, gateway: (name: string) => TrackedGateway, originalRevisionId?: string, instruction?: string): Promise<Artifact> {
    const saved = this.runs.artifact(run.id, step);
    if (saved !== undefined) return ArtifactSchema.parse(saved);
    const original = originalRevisionId ? this.book.revision(originalRevisionId) : undefined;
    const writingPrompt = `${prompt('writer-v1')}\n${JSON.stringify(context)}${original ? `\n原候选：${original.content}\n作者修订要求：${instruction ?? ''}` : ''}`;
    const result = await gateway(`${step}:v1`).generateText({ prompt: writingPrompt, maxOutputTokens: run.config.model.maxOutputTokens });
    return this.book.db.transaction(() => {
      lease.assert();
      const parent = original?.id ?? this.book.snapshot().state.chapters.find(item => item.id === context.plan.chapterId)?.revisionId ?? null;
      const content = /^##[ \t]/u.test(result.value) ? result.value : `## ${context.plan.title}\n\n${result.value}\n`;
      if (blocks(content).filter(block => !block.text.startsWith('## ')).length === 0) throw new Error('候选没有有效正文。');
      const revision = this.book.insertRevision(context.plan.chapterId, content, parent, run.id);
      const proposal = this.proposals.create('draft', run.baseVersion, { chapterId: context.plan.chapterId, revisionId: revision.id, planRevisionId: context.plan.revisionId, contentHash: revision.contentHash }, run.id);
      const artifact = { proposalId: proposal.id, revisionId: revision.id }; this.runs.saveArtifact(run.id, step, artifact);
      return artifact;
    }).immediate();
  }

  private async audit(run: Run, artifact: Artifact, context: ContextSnapshot, lease: WriteLease, gateway: (name: string) => TrackedGateway) {
    if (!artifact.revisionId) throw new Error('审稿缺少目标正文版本。');
    const revision = this.book.revision(artifact.revisionId);
    const proposal = this.proposals.get(artifact.proposalId);
    const binding = proposal.kind === 'selection' ? SelectionSchema.parse(proposal.payload).drafts.find(draft => draft.revisionId === revision.id) : DraftPayloadSchema.parse(proposal.payload);
    if (!binding || proposal.status !== 'pending' || proposal.baseVersion !== run.baseVersion || binding.contentHash !== revision.contentHash || ('planRevisionId' in binding && binding.planRevisionId !== context.plan.revisionId)) throw new Error('候选、计划或项目版本不一致。');
    const sourceIds = new Set([...contextRevisionIds(context), revision.id]);
    const sources = [...sourceIds].map(id => { const source = this.book.revision(id); return { chapterId: source.chapterId, revisionId: id, contentHash: source.contentHash, blocks: blocks(source.content) }; });
    const reviewKey = `review:${revision.id}`;
    let review: Review;
    if (this.runs.artifact(run.id, reviewKey) !== undefined) {
      const row = this.reports.latest('reviews', revision.id);
      if (!row || row.status !== 'reviewed') throw new Error('已保存审稿记录不可用。');
      review = ReviewSchema.parse(JSON.parse(row.payload));
    } else {
      try {
        const response = await gateway(reviewKey).generateObject({ prompt: `${prompt(context.protocolVersion ? 'reviewer-story-v1' : 'reviewer-v1')}\n${JSON.stringify({ targetRevisionId: revision.id, context, sources })}`, maxOutputTokens: run.config.model.maxOutputTokens, schema: ReviewSchema });
        review = validateReview(this.book, response.value, sourceIds);
        this.book.db.transaction(() => { lease.assert(); const id = this.reports.save('reviews', revision.id, run.baseVersion, run.id, 'reviewed', review); this.runs.saveArtifact(run.id, reviewKey, { id }); }).immediate();
      } catch (error) {
        lease.assert(); this.reports.save('reviews', revision.id, run.baseVersion, run.id, 'failed', { code: 'review-unavailable' }); throw error;
      }
    }
    const extractionKey = `extract:${revision.id}`;
    if (this.runs.artifact(run.id, extractionKey) === undefined) {
      try {
        const story = context.protocolVersion ? this.book.snapshot(run.baseVersion).state.story : undefined;
        const identity = story ? { entities: story.entities, events: story.events.map(item => ({ id: item.id })), scenes: story.scenes.filter(item => item.chapterId === revision.chapterId).map(item => ({ id: item.id, eventId: item.eventId })), claimIds: story.claims.map(item => item.id) } : undefined;
        const response = await gateway(extractionKey).generateObject({ prompt: `${prompt(story ? 'extractor-story-v1' : 'extractor-v1')}\n${JSON.stringify({ ...sources.find(source => source.revisionId === revision.id), ...(identity ? { identities: identity } : {}) })}`, maxOutputTokens: run.config.model.maxOutputTokens, schema: story ? ExtractionSchema.extend({ story: StoryChangesSchema }) : ExtractionSchema });
        const extraction = validateExtraction(this.book, response.value, revision.id);
        this.book.db.transaction(() => { lease.assert(); const id = this.reports.save('extractions', revision.id, run.baseVersion, run.id, 'extracted', extraction); new MemoryStore(this.book).ingest(revision.id, extraction); if (extraction.story) this.book.db.prepare('INSERT INTO story_candidates VALUES (?, ?, ?)').run(run.id, revision.id, JSON.stringify(extraction.story)); this.runs.saveArtifact(run.id, extractionKey, { id }); }).immediate();
      } catch (error) {
        lease.assert(); this.reports.save('extractions', revision.id, run.baseVersion, run.id, 'failed', { code: 'extraction-unavailable' }); throw error;
      }
    }
    return review;
  }
}
