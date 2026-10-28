import { z } from 'zod';
import { ExtractionSchema } from '../domain/review.js';
import type { AppConfig } from '../domain/model-config.js';
import { BookStore } from '../storage/book-store.js';
import { MemoryStore, SummarySchema } from '../storage/memory-store.js';
import { RunStore } from '../storage/run-store.js';
import type { Budget } from '../storage/run-store.js';
import type { TextTransport } from '../llm/sdk-provider.js';
import { TrackedGateway } from '../llm/tracked-gateway.js';
import { blocks } from '../review/evidence.js';
import { prompt } from '../agents/prompts.js';
import { withRunLease } from './lease.js';

const InputSchema = z.strictObject({ revisionIds: z.array(z.string()), configSource: z.string(), promptVersion: z.literal('memory-v1') });
export class MemoryWorkflow {
  readonly runs: RunStore; readonly memory: MemoryStore;
  constructor(readonly book: BookStore, readonly config: AppConfig, readonly transport: TextTransport, readonly budget: Budget, readonly configSource = 'builtin') {
    this.runs = new RunStore(book); this.memory = new MemoryStore(book);
  }
  async rebuild(chapterId?: string) {
    const chapters = this.book.snapshot().state.chapters.filter(chapter => chapterId === undefined || chapter.id === chapterId);
    if (chapterId !== undefined && !chapters.length) throw new Error('正式稿中没有该章节。');
    const revisionIds = chapters.filter(chapter => this.memory.needsExtraction(chapter.revisionId) || this.memory.summary(chapter.revisionId) === undefined).map(chapter => chapter.revisionId);
    if (!revisionIds.length) return { rebuilt: [], runId: null };
    const run = this.runs.create('memory', { revisionIds, configSource: this.configSource, promptVersion: 'memory-v1' }, this.config, this.budget);
    return this.execute(run.id, false);
  }
  async resume(id: string, retryUnknown = false) { return this.execute(id, true, retryUnknown); }
  private async execute(id: string, recover: boolean, retryUnknown = false) {
    const run = this.runs.get(id); const input = InputSchema.parse(run.input);
    if (run.status === 'succeeded') return { runId: id, rebuilt: input.revisionIds };
    return withRunLease(this.runs, id, async lease => {
      try {
        for (const revisionId of input.revisionIds) {
          const revision = this.book.revision(revisionId);
          const source = { chapterId: revision.chapterId, revisionId, contentHash: revision.contentHash, blocks: blocks(revision.content) };
          if (this.memory.needsExtraction(revisionId)) {
            const gateway = new TrackedGateway(this.runs, id, `memory-facts:${revisionId}`, this.transport, retryUnknown, lease.assert);
            const response = await gateway.generateObject({ prompt: `${prompt('extractor-v1')}\n${JSON.stringify(source)}`, maxOutputTokens: run.config.model.maxOutputTokens, schema: ExtractionSchema });
            this.book.db.transaction(() => { lease.assert(); this.memory.ingest(revisionId, response.value); }).immediate();
          }
          if (this.memory.summary(revisionId) === undefined) {
            const gateway = new TrackedGateway(this.runs, id, `memory-summary:${revisionId}`, this.transport, retryUnknown, lease.assert);
            const response = await gateway.generateObject({ prompt: `生成简短的章节摘要，保留事件、人物变化和未完事项，不把计划当事实。只引用本章原句。\n${JSON.stringify(source)}`, maxOutputTokens: run.config.model.maxOutputTokens, schema: SummarySchema });
            this.book.db.transaction(() => { lease.assert(); this.memory.saveSummary(revisionId, response.value); }).immediate();
          }
        }
        this.runs.status(id, 'succeeded'); return { runId: id, rebuilt: input.revisionIds };
      } catch (error) { lease.fail('memory-rebuild-failed'); throw error; }
    }, recover);
  }
}
