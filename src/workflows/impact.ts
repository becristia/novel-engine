import { z } from 'zod';
import { ImpactSchema, PatchPayloadSchema } from '../domain/patch.js';
import type { AppConfig } from '../domain/model-config.js';
import { BookStore } from '../storage/book-store.js';
import { ProposalStore } from '../storage/proposal-store.js';
import { RunStore } from '../storage/run-store.js';
import type { Budget } from '../storage/run-store.js';
import type { TextTransport } from '../llm/sdk-provider.js';
import { TrackedGateway } from '../llm/tracked-gateway.js';
import { normalizeImpact } from '../proposals/patches.js';
import { blocks } from '../review/evidence.js';
import { prompt } from '../agents/prompts.js';
import { withRunLease } from './lease.js';
import { activeStory } from '../context/story-builder.js';

const InputSchema = z.strictObject({ sourceChapterId: z.string(), instruction: z.string().min(1), revisionIds: z.array(z.string()), omittedChapterIds: z.array(z.string()), configSource: z.string(), promptVersion: z.literal('impact-v1'), parentId: z.string().nullable() });
export class ImpactWorkflow {
  readonly runs: RunStore; readonly proposals: ProposalStore;
  constructor(readonly book: BookStore, readonly config: AppConfig, readonly transport: TextTransport, readonly budget: Budget, readonly configSource = 'builtin') {
    this.runs = new RunStore(book); this.proposals = new ProposalStore(book);
  }
  async analyze(sourceChapterId: string, instruction: string, parentId: string | null = null) {
    const snapshot = this.book.snapshot(); const source = snapshot.state.chapters.find(chapter => chapter.id === sourceChapterId);
    if (!source || !instruction.trim()) throw new Error('需要有效的正式章节和修改要求。');
    const text = this.book.revision(source.revisionId).content;
    const terms = [...(snapshot.state.plans[sourceChapterId]?.characters ?? []), ...Object.entries(snapshot.state.aliases).flatMap(([id, names]) => [id, ...names]).filter(name => text.includes(name))];
    const selected = snapshot.state.chapters.filter(chapter => chapter.id === sourceChapterId || !terms.length || terms.some(term => this.book.revision(chapter.revisionId).content.includes(term)));
    const input = InputSchema.parse({ sourceChapterId, instruction, revisionIds: selected.map(chapter => chapter.revisionId), omittedChapterIds: snapshot.state.chapters.filter(chapter => !selected.includes(chapter)).map(chapter => chapter.id), configSource: this.configSource, promptVersion: 'impact-v1', parentId });
    const run = this.runs.create('impact', input, this.config, this.budget, snapshot.version);
    return this.execute(run.id, false);
  }
  async revalidate(id: string) {
    const previous = this.proposals.get(id); if (previous.kind !== 'patch') throw new Error('只能重新分析原局部修改提案。');
    const payload = PatchPayloadSchema.parse(previous.payload);
    return this.analyze(payload.sourceChapterId, `${payload.instruction}\n请基于当前正式正文重新判断，只提出仍未解决的修改，不重复已经接受的内容。`, id);
  }
  async resume(id: string, retryUnknown = false) { return this.execute(id, true, retryUnknown); }
  private async execute(id: string, recover: boolean, retryUnknown = false) {
    const run = this.runs.get(id); const input = InputSchema.parse(run.input);
    const existing = this.runs.artifact(id, 'result') as { proposalId: string } | undefined;
    if (existing && run.status === 'succeeded') return { runId: id, proposal: this.proposals.get(existing.proposalId) };
    return withRunLease(this.runs, id, async lease => {
      try {
        if (existing) return { runId: id, proposal: this.proposals.get(existing.proposalId) };
        const sources = input.revisionIds.map(revisionId => { const revision = this.book.revision(revisionId); return { chapterId: revision.chapterId, revisionId, contentHash: revision.contentHash, blocks: blocks(revision.content) }; });
        const gateway = new TrackedGateway(this.runs, id, 'impact:v1', this.transport, retryUnknown, lease.assert);
        const state = this.book.snapshot(run.baseVersion).state;
        const result = await gateway.generateObject({ prompt: `${prompt('impact-v1')}\n${JSON.stringify({ instruction: input.instruction, sources, constraints: state.constraints, ...(state.story ? { story: activeStory(this.book, run.baseVersion) } : {}) })}`, maxOutputTokens: run.config.model.maxOutputTokens, schema: ImpactSchema });
        const output = normalizeImpact(this.book, result.value, new Set(input.revisionIds));
        return this.book.db.transaction(() => {
          lease.assert();
          const proposal = this.proposals.create('patch', run.baseVersion, { ...output, instruction: input.instruction, sourceChapterId: input.sourceChapterId, searchedChapterIds: sources.map(source => source.chapterId), omittedChapterIds: input.omittedChapterIds }, id, input.parentId);
          this.runs.saveArtifact(id, 'result', { proposalId: proposal.id }); this.runs.status(id, 'awaiting_approval');
          return { runId: id, proposal };
        }).immediate();
      } catch (error) { lease.fail('impact-failed'); throw error; }
    }, recover);
  }
}
