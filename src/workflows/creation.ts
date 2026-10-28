import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PlannerOutputSchema, DraftPayloadSchema } from '../domain/planning.js';
import { ReviewSchema, ExtractionSchema } from '../domain/review.js';
import type { Review } from '../domain/review.js';
import type { AppConfig } from '../domain/model-config.js';
import { BookStore } from '../storage/book-store.js';
import { ProposalStore } from '../storage/proposal-store.js';
import { ReviewStore } from '../storage/review-store.js';
import { MemoryStore } from '../storage/memory-store.js';
import { RunStore } from '../storage/run-store.js';
import type { Budget, Run } from '../storage/run-store.js';
import { buildContext, ContextSchema } from '../context/builder.js';
import type { ContextSnapshot } from '../context/builder.js';
import { blocks, validateReview, validateExtraction } from '../review/evidence.js';
import { prompt } from '../agents/prompts.js';
import { TrackedGateway } from '../llm/tracked-gateway.js';
import type { TextTransport } from '../llm/sdk-provider.js';
import { withRunLease } from './lease.js';
import type { WriteLease } from './lease.js';

const ArtifactSchema = z.strictObject({ proposalId: z.string(), revisionId: z.string().optional() });
type Artifact = z.infer<typeof ArtifactSchema>;
const common = { configSource: z.string(), promptVersion: z.string() };
const PlanInput = z.strictObject({ ...common, brief: z.string().min(1), chapters: z.number().int().min(1).max(20) });
const ChapterInput = z.strictObject({ ...common, chapter: z.number().int().positive(), context: ContextSchema, originalRevisionId: z.string().optional(), instruction: z.string().optional(), autoRevise: z.boolean().default(false) });
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
    const input = PlanInput.parse({ brief, chapters, configSource: this.configSource, promptVersion: 'planner-v1' });
    return this.execute(this.runs.create('plan', input, this.config, this.budget), false);
  }

  async draft(chapter: number) { return this.startChapter('draft', chapter); }
  async write(chapter: number, autoRevise = false) { return this.startChapter('write', chapter, { autoRevise }); }

  async revise(revisionId: string, instruction: string) {
    if (!instruction.trim()) throw new Error('修订要求不能为空。');
    const target = this.findCandidate(revisionId);
    const payload = DraftPayloadSchema.parse(this.proposals.get(target.proposalId).payload);
    const plan = this.book.snapshot().state.plans[payload.chapterId];
    if (!plan) throw new Error('找不到对应的已批准计划。');
    return this.startChapter('revise', plan.ordinal, { originalRevisionId: revisionId, instruction });
  }

  async review(revisionId: string) {
    const target = this.findCandidate(revisionId);
    const revision = this.book.revision(revisionId);
    const context = buildContext(this.book, revision.chapterId, this.config);
    const input = ReviewInput.parse({ target, context, configSource: this.configSource, promptVersion: 'reviewer-v1' });
    return this.execute(this.runs.create('review', input, this.config, this.budget), false);
  }

  async resume(id: string, retryUnknown = false) {
    const run = this.runs.get(id);
    if (run.status === 'succeeded') return this.render(id, ArtifactSchema.parse(this.runs.artifact(id, 'result')));
    return this.execute(run, true, retryUnknown);
  }

  private async startChapter(kind: 'draft' | 'write' | 'revise', chapter: number, extra: { autoRevise?: boolean; originalRevisionId?: string; instruction?: string } = {}) {
    const context = buildContext(this.book, chapter, this.config);
    const input = ChapterInput.parse({ chapter, context, configSource: this.configSource, promptVersion: 'writer-v1', ...extra });
    return this.execute(this.runs.create(kind, input, this.config, this.budget), false);
  }

  private findCandidate(revisionId: string): Artifact {
    const proposal = this.proposals.list().find(item => item.kind === 'draft' && item.status === 'pending' && DraftPayloadSchema.parse(item.payload).revisionId === revisionId);
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
          const result = await gateway('plan:v1').generateObject({ prompt: `${prompt('planner-v1')}\n章节数：${input.chapters}\n作者要求：${input.brief}`, maxOutputTokens: run.config.model.maxOutputTokens, schema: PlannerOutputSchema });
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
          artifact = await this.generateCandidate(run, 'draft', input.context, lease, gateway, input.originalRevisionId, input.instruction);
          if (run.kind !== 'draft') {
            let review = await this.audit(run, artifact, input.context, lease, gateway);
            if (input.autoRevise && review.issues.length) {
              const original = artifact;
              artifact = await this.generateCandidate(run, 'revision', input.context, lease, gateway, original.revisionId, JSON.stringify(review));
              review = await this.audit(run, artifact, input.context, lease, gateway);
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
    const payload = DraftPayloadSchema.parse(proposal.payload);
    if (proposal.status !== 'pending' || proposal.baseVersion !== run.baseVersion || payload.contentHash !== revision.contentHash || payload.planRevisionId !== context.plan.revisionId) throw new Error('候选、计划或项目版本不一致。');
    const sourceIds = new Set([...context.sources.filter(source => !['plan', 'constraint'].includes(source.kind)).map(source => source.revisionId), revision.id]);
    const sources = [...sourceIds].map(id => { const source = this.book.revision(id); return { chapterId: source.chapterId, revisionId: id, contentHash: source.contentHash, blocks: blocks(source.content) }; });
    const reviewKey = `review:${revision.id}`;
    let review: Review;
    if (this.runs.artifact(run.id, reviewKey) !== undefined) {
      const row = this.reports.latest('reviews', revision.id);
      if (!row || row.status !== 'reviewed') throw new Error('已保存审稿记录不可用。');
      review = ReviewSchema.parse(JSON.parse(row.payload));
    } else {
      try {
        const response = await gateway(reviewKey).generateObject({ prompt: `${prompt('reviewer-v1')}\n${JSON.stringify({ targetRevisionId: revision.id, context, sources })}`, maxOutputTokens: run.config.model.maxOutputTokens, schema: ReviewSchema });
        review = validateReview(this.book, response.value, sourceIds);
        this.book.db.transaction(() => { lease.assert(); const id = this.reports.save('reviews', revision.id, run.baseVersion, run.id, 'reviewed', review); this.runs.saveArtifact(run.id, reviewKey, { id }); }).immediate();
      } catch (error) {
        lease.assert(); this.reports.save('reviews', revision.id, run.baseVersion, run.id, 'failed', { code: 'review-unavailable' }); throw error;
      }
    }
    const extractionKey = `extract:${revision.id}`;
    if (this.runs.artifact(run.id, extractionKey) === undefined) {
      try {
        const response = await gateway(extractionKey).generateObject({ prompt: `${prompt('extractor-v1')}\n${JSON.stringify(sources.find(source => source.revisionId === revision.id))}`, maxOutputTokens: run.config.model.maxOutputTokens, schema: ExtractionSchema });
        const extraction = validateExtraction(this.book, response.value, revision.id);
        this.book.db.transaction(() => { lease.assert(); const id = this.reports.save('extractions', revision.id, run.baseVersion, run.id, 'extracted', extraction); new MemoryStore(this.book).ingest(revision.id, extraction); this.runs.saveArtifact(run.id, extractionKey, { id }); }).immediate();
      } catch (error) {
        lease.assert(); this.reports.save('extractions', revision.id, run.baseVersion, run.id, 'failed', { code: 'extraction-unavailable' }); throw error;
      }
    }
    return review;
  }
}
