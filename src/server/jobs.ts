import { JobSchema } from '../domain/workbench.js';
import { BookStore } from '../storage/book-store.js';
import { RunStore } from '../storage/run-store.js';
import { hash } from '../domain/workspace.js';
import { CreationWorkflow } from '../workflows/creation.js';
import { MemoryWorkflow } from '../workflows/memory.js';
import { ImpactWorkflow } from '../workflows/impact.js';
import { ProbeWorkflow } from '../workflows/probe.js';
import { createTransport } from '../llm/factory.js';
import type { LoadedConfig } from '../llm/config.js';
import type { TextTransport } from '../llm/sdk-provider.js';
import { Library } from './library.js';
import { HttpError } from '../application/workbench-errors.js';
import type { WorkbenchJob } from '../domain/workbench.js';

export type TransportFactory = (loaded: LoadedConfig, consumed?: number) => Promise<TextTransport>;
export class Jobs {
  private readonly busy = new Set<string>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly starts = new Map<string, { fingerprint: string; promise: Promise<{ runId: string | null }> }>();
  constructor(readonly library: Library, readonly config: () => Promise<LoadedConfig>, readonly transport: TransportFactory = createTransport) {}
  async idle(): Promise<void> { await Promise.all([...this.pending]); }
  start(workspaceId: string, value: unknown): Promise<{ runId: string | null }> {
    const input = JobSchema.parse(value); const key = `${workspaceId}:${input.requestId}`; const fingerprint = hash(JSON.stringify(input));
    const existing = this.starts.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new HttpError(409, 'request-conflict', '同一请求身份不能用于不同任务。');
      return existing.promise;
    }
    const promise = this.launch(workspaceId, input);
    this.starts.set(key, { fingerprint, promise });
    void promise.finally(() => this.starts.delete(key)).catch(() => undefined);
    return promise;
  }
  private async launch(workspaceId: string, input: WorkbenchJob): Promise<{ runId: string | null }> {
    const directory = this.library.path(workspaceId);
    const book = new BookStore(directory); const runs = new RunStore(book);
    const requestName = `ui-request:${input.requestId}`; const fingerprint = hash(JSON.stringify(input));
    const existing = book.db.prepare('SELECT run_id AS runId, value FROM run_artifacts WHERE name = ?').get(requestName) as { runId: string; value: string } | undefined;
    if (existing) {
      book.close();
      if (JSON.parse(existing.value).fingerprint !== fingerprint) throw new HttpError(409, 'request-conflict', '同一请求身份不能用于不同任务。');
      return { runId: existing.runId };
    }
    if (this.busy.has(workspaceId)) { book.close(); throw new HttpError(409, 'busy', '本作品已有任务正在执行。'); }
    this.busy.add(workspaceId);
    try {
      const stored = input.kind === 'resume' ? runs.get(input.runId) : null;
      const loaded = stored ? { config: stored.config, source: (stored.input as { configSource?: string }).configSource ?? 'builtin' } : await this.config();
      const transport = await this.transport(loaded, stored ? runs.attempts(stored.id).length : 0);
      if (book.project().version !== input.expectedVersion) throw new HttpError(409, 'version-conflict', '项目版本已改变，请刷新后重新发起任务。');
      if (stored?.cancelled) throw new HttpError(409, 'cancelled', '运行已取消，不能恢复。');
      if (stored && runs.attempts(stored.id).some(item => ['unknown', 'inflight'].includes(item.status)) && input.kind === 'resume' && !input.retryUnknown) throw new HttpError(409, 'unknown-request', '存在结果未知的请求，请明确确认是否重试。');
      const budget = stored?.budget ?? input.budget;
      const kind = stored?.kind ?? input.kind;
      const workflow = kind === 'memory' ? new MemoryWorkflow(book, loaded.config, transport, budget, loaded.source)
        : ['impact', 'revalidate'].includes(kind) ? new ImpactWorkflow(book, loaded.config, transport, budget, loaded.source)
        : kind === 'probe' ? new ProbeWorkflow(book, loaded.config, transport, budget, loaded.source)
        : new CreationWorkflow(book, loaded.config, transport, budget, loaded.source);
      let runId: string | null = stored?.id ?? null;
      workflow.runs.expectedBaseVersion = input.expectedVersion;
      workflow.runs.onCreated = run => { runId = run.id; runs.saveArtifact(run.id, requestName, { fingerprint }); };
      if (stored) runs.saveArtifact(stored.id, requestName, { fingerprint });
      let execution: Promise<unknown>;
      switch (input.kind) {
        case 'plan': execution = (workflow as CreationWorkflow).plan(input.brief, input.chapters); break;
        case 'write': execution = (workflow as CreationWorkflow).write(input.chapter, input.reviseOnce); break;
        case 'draft': execution = (workflow as CreationWorkflow).draft(input.chapter); break;
        case 'review': execution = (workflow as CreationWorkflow).review(input.revisionId); break;
        case 'revise': execution = (workflow as CreationWorkflow).revise(input.revisionId, input.instruction); break;
        case 'impact': execution = (workflow as ImpactWorkflow).analyze(input.chapterId, input.instruction); break;
        case 'revalidate': execution = (workflow as ImpactWorkflow).revalidate(input.proposalId); break;
        case 'memory': execution = (workflow as MemoryWorkflow).rebuild(input.chapterId); break;
        case 'probe': execution = (workflow as ProbeWorkflow).start(); break;
        case 'resume':
          if (stored?.kind === 'selection') { runs.assertRunnable(stored.id); execution = Promise.resolve(); }
          else execution = workflow.resume(input.runId, input.retryUnknown);
      }
      if (runId === null) { await execution; book.close(); this.busy.delete(workspaceId); return { runId: null }; }
      const id = runId;
      const finished = execution.catch(() => {
        const run = runs.get(id);
        if (!['cancelled', 'stale', 'succeeded', 'awaiting_approval'].includes(run.status)) runs.status(id, 'failed', 'ui-task-failed');
      }).finally(() => { book.close(); this.busy.delete(workspaceId); this.pending.delete(finished); });
      this.pending.add(finished);
      return { runId: id };
    } catch (error) { if (book.db.open) book.close(); this.busy.delete(workspaceId); throw error; }
  }
}
