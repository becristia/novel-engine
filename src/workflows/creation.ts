import { randomUUID } from 'node:crypto';
import { PlannerOutputSchema } from '../domain/planning.js';
import type { AppConfig } from '../domain/model-config.js';
import { BookStore } from '../storage/book-store.js';
import { ProposalStore } from '../storage/proposal-store.js';
import { RunStore } from '../storage/run-store.js';
import type { Budget } from '../storage/run-store.js';
import { buildContext } from '../context/builder.js';
import { prompt } from '../agents/prompts.js';
import { TrackedGateway } from '../llm/tracked-gateway.js';
import type { TextTransport } from '../llm/sdk-provider.js';
import { withRunLease } from './lease.js';

export class CreationWorkflow {
  readonly runs: RunStore;
  readonly proposals: ProposalStore;
  constructor(readonly book: BookStore, readonly config: AppConfig, readonly transport: TextTransport, readonly budget: Budget, readonly configSource = 'builtin') {
    this.runs = new RunStore(book); this.proposals = new ProposalStore(book);
  }

  async plan(brief: string, chapters: number) {
    if (!brief.trim() || !Number.isSafeInteger(chapters) || chapters < 1 || chapters > 20) throw new Error('创作要求不能为空，每批计划支持 1～20 章。');
    const run = this.runs.create('plan', { brief, chapters, configSource: this.configSource, promptVersion: 'planner-v1' }, this.config, this.budget);
    return withRunLease(this.runs, run.id, async lease => {
      try {
        const gateway = new TrackedGateway(this.runs, run.id, 'plan:v1', this.transport, false, lease.assert);
        const result = await gateway.generateObject({ prompt: `${prompt('planner-v1')}\n章节数：${chapters}\n作者要求：${brief}`, maxOutputTokens: this.config.model.maxOutputTokens, schema: PlannerOutputSchema });
        if (result.value.chapters.length !== chapters) throw new Error('模型计划数量不符合请求。');
        return this.book.db.transaction(() => {
          lease.assert();
          const snapshot = this.book.snapshot(run.baseVersion);
          const offset = Math.max(snapshot.state.chapters.length, ...Object.values(snapshot.state.plans).map(item => item.ordinal), 0);
          const plans = result.value.chapters.map((content, index) => ({ ...content, chapterId: randomUUID(), revisionId: randomUUID(), ordinal: offset + index + 1 }));
          const proposal = this.proposals.create('plan', run.baseVersion, { plans }, run.id);
          this.runs.status(run.id, 'awaiting_approval');
          return { runId: run.id, proposal };
        }).immediate();
      } catch (error) { lease.fail('plan-failed'); throw error; }
    });
  }

  async draft(chapter: number) {
    const context = buildContext(this.book, chapter, this.config);
    const run = this.runs.create('draft', { chapter, context, configSource: this.configSource, promptVersion: 'writer-v1' }, this.config, this.budget);
    return withRunLease(this.runs, run.id, async lease => {
      try {
        const gateway = new TrackedGateway(this.runs, run.id, 'draft:v1', this.transport, false, lease.assert);
        const result = await gateway.generateText({ prompt: `${prompt('writer-v1')}\n${JSON.stringify(context)}`, maxOutputTokens: this.config.model.maxOutputTokens });
        return this.book.db.transaction(() => {
          lease.assert();
          const parent = this.book.snapshot().state.chapters.find(item => item.id === context.plan.chapterId)?.revisionId ?? null;
          const content = /^##[ \t]/u.test(result.value) ? result.value : `## ${context.plan.title}\n\n${result.value}\n`;
          const revision = this.book.insertRevision(context.plan.chapterId, content, parent, run.id);
          const proposal = this.proposals.create('draft', run.baseVersion, { chapterId: context.plan.chapterId, revisionId: revision.id, planRevisionId: context.plan.revisionId, contentHash: revision.contentHash }, run.id);
          this.runs.status(run.id, 'awaiting_approval');
          return { runId: run.id, proposal, revision };
        }).immediate();
      } catch (error) { lease.fail('draft-failed'); throw error; }
    });
  }
}
