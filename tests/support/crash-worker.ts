import '../deny-network.js';
import { once } from 'node:events';
import { BookStore } from '../../src/storage/book-store.js';
import { RunStore } from '../../src/storage/run-store.js';
import { CommitService } from '../../src/application/workspace.js';
import { CreationWorkflow } from '../../src/workflows/creation.js';
import { WriteLease } from '../../src/workflows/lease.js';
import { defaultConfig } from '../../src/domain/model-config.js';
import { FakeProvider } from '../../src/llm/fake-provider.js';
import type { TextTransport } from '../../src/llm/sdk-provider.js';

const [directory, mode] = process.argv.slice(2);
if (!directory || !mode) throw new Error('Missing test worker arguments.');
const book = new BookStore(directory); const runs = new RunStore(book); const config = defaultConfig();
config.model.timeoutMs = 10000;
const budget = { maxRequests: 8, maxTokens: 64000 };
const die = (): never => { process.kill(process.pid, 'SIGKILL'); throw new Error('unreachable'); };

if (mode === 'mid-commit') {
  const chapter = book.snapshot().state.chapters[0]!;
  book.commit(book.project().version, 'mid-commit', 'mid-commit', () => { book.insertRevision(chapter.id, '不应持久化的正文。', chapter.revisionId); die(); });
} else if (mode === 'after-commit') {
  const chapter = book.snapshot().state.chapters[0]!;
  new CommitService(book).replace(chapter.id, '提交后崩溃的新正文。', book.project().version, 'crash-commit'); die();
} else if (mode === 'hold') {
  const run = runs.create('test-hold', {}, config, budget); const lease = new WriteLease(runs, run.id); lease.acquire();
  process.stdout.write(`${JSON.stringify({ ready: true, runId: run.id })}\n`);
  setInterval(() => {}, 1000);
} else {
  let transport: TextTransport = new FakeProvider(['进程恢复后的候选正文。']);
  if (mode === 'response' || mode === 'response-truncated') {
    if (mode === 'response-truncated') transport = { generateText: async () => ({ value: '尚未写完的正文', modelId: 'fake-v1', finishReason: 'length', usage: { inputTokens: 10, outputTokens: 20 } }) };
    const original = RunStore.prototype.receive;
    RunStore.prototype.receive = function (...args) { original.apply(this, args); die(); };
  } else if (mode === 'inflight') transport = { generateText: async () => die() };
  else if (mode === 'late') transport = { generateText: async () => {
    process.stdout.write(`${JSON.stringify({ ready: true })}\n`);
    await once(process.stdin, 'data'); return { value: '迟到候选正文。', modelId: 'fake-v1', usage: null };
  } };
  try {
    await new CreationWorkflow(book, config, transport, budget).draft(1);
  } catch {
    process.exitCode = 2;
  } finally { book.close(); }
}
