import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { createWorkspace } from '../src/application/workspace.js';
import { defaultConfig } from '../src/domain/model-config.js';
import { BookStore } from '../src/storage/book-store.js';
import { RunStore } from '../src/storage/run-store.js';
import { FakeProvider } from '../src/llm/fake-provider.js';
import { ProbeWorkflow } from '../src/workflows/probe.js';
import { replayRun } from '../src/workflows/replay.js';

it('replays and resumes a completed probe without network calls and exposes unresolved attempts', async () => {
  await mkdir('.tmp/milestone-tests', { recursive: true }); const directory = await mkdtemp(resolve('.tmp/milestone-tests/replay-'));
  createWorkspace(directory, '重放验收'); const book = new BookStore(directory);
  try {
    const config = defaultConfig(); const budget = { maxRequests: 2, maxTokens: 5000 };
    const workflow = new ProbeWorkflow(book, config, new FakeProvider(['{"ok":true}']), budget);
    const result = await workflow.start(); expect((await workflow.resume(result.runId)).result).toEqual(result.result);
    expect(() => new RunStore(book).cancel(result.runId)).toThrow('已经完成');
    expect(replayRun(directory, result.runId)).toMatchObject({ ok: true, readOnly: true, databaseChanges: 0, qualityEvaluated: false });
    const runs = new RunStore(book); const unknown = runs.create('probe', {}, config, budget);
    runs.reserve(unknown.id, 'probe:v1', 'incomplete-fingerprint', '请求', 128); runs.recoverUnknown(unknown.id);
    const report = replayRun(directory, unknown.id); expect(report.ok).toBe(false); expect(report.unresolved).toHaveLength(1);
    expect(runs.attempts(unknown.id)[0]!.status).toBe('unknown');
  } finally { book.close(); await rm(directory, { recursive: true }); }
});
