import { z } from 'zod';
import type { AppConfig } from '../domain/model-config.js';
import { BookStore } from '../storage/book-store.js';
import { RunStore } from '../storage/run-store.js';
import type { Budget } from '../storage/run-store.js';
import type { TextTransport } from '../llm/sdk-provider.js';
import { TrackedGateway } from '../llm/tracked-gateway.js';
import { withRunLease } from './lease.js';

export class ProbeWorkflow {
  readonly runs: RunStore;
  constructor(readonly book: BookStore, readonly config: AppConfig, readonly transport: TextTransport, readonly budget: Budget, readonly configSource = 'builtin') { this.runs = new RunStore(book); }
  async start() {
    const run = this.runs.create('probe', { configSource: this.configSource, promptVersion: 'probe-v1' }, this.config, this.budget);
    return this.execute(run.id, false);
  }
  async resume(id: string, retryUnknown = false) { return this.execute(id, true, retryUnknown); }
  private async execute(id: string, recover: boolean, retryUnknown = false) {
    const run = this.runs.get(id); const saved = this.runs.artifact(id, 'result');
    if (run.status === 'succeeded' && saved !== undefined) return { runId: id, result: saved };
    return withRunLease(this.runs, id, async lease => {
      try {
        const gateway = new TrackedGateway(this.runs, id, 'probe:v1', this.transport, retryUnknown, lease.assert);
        const result = await gateway.generateObject({ prompt: '返回一个对象，ok 为 true。', maxOutputTokens: Math.min(128, run.config.model.maxOutputTokens), schema: z.strictObject({ ok: z.literal(true) }) });
        this.book.db.transaction(() => { lease.assert(); this.runs.saveArtifact(id, 'result', result); this.runs.status(id, 'succeeded'); }).immediate();
        return { runId: id, result };
      } catch (error) { lease.fail('probe-failed'); throw error; }
    }, recover);
  }
}
