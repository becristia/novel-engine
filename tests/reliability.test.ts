import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, CommitService } from '../src/application/workspace.js';
import { ProposalService } from '../src/application/proposals.js';
import { defaultConfig } from '../src/domain/model-config.js';
import { BookStore } from '../src/storage/book-store.js';
import { RunStore } from '../src/storage/run-store.js';
import { MemoryStore } from '../src/storage/memory-store.js';
import { migrateDatabase } from '../src/storage/database.js';
import { FakeProvider } from '../src/llm/fake-provider.js';
import { CreationWorkflow } from '../src/workflows/creation.js';
import { WriteLease } from '../src/workflows/lease.js';
import { replayRun } from '../src/workflows/replay.js';
import { blocks } from '../src/review/evidence.js';

const config = defaultConfig(); const budget = { maxRequests: 8, maxTokens: 64000 };
const plan = { title: '归港', goal: '发现灯光', characters: ['林舟'], constraints: [], events: [], targetLength: 800 };

describe('process recovery and transactional boundaries', () => {
  let directory: string; let book: BookStore;
  const children: ReturnType<typeof spawn>[] = [];
  beforeEach(async () => {
    await mkdir('.tmp/milestone-tests', { recursive: true }); directory = await mkdtemp(resolve('.tmp/milestone-tests/reliability-'));
    createWorkspace(directory, '故障验收'); book = new BookStore(directory);
  });
  afterEach(async () => {
    for (const child of children.splice(0)) {
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
    }
    if (book.db.open) book.close(); await rm(directory, { recursive: true });
  });
  async function preparePlan() {
    const result = await new CreationWorkflow(book, config, new FakeProvider([JSON.stringify({ chapters: [plan] })]), budget).plan('一章故事。', 1);
    new ProposalService(book).approve(result.proposal.id);
  }
  function worker(mode: string) {
    const child = spawn(process.execPath, ['--import', 'tsx', 'tests/support/crash-worker.ts', directory, mode], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
    children.push(child); return child;
  }
  async function ready(child: ReturnType<typeof spawn>) {
    const signal = AbortSignal.timeout(10000);
    await once(child.stdout!, 'data', { signal });
  }

  it('survives SIGKILL after response persistence without repeating the model call', async () => {
    await preparePlan(); const child = worker('response'); const [, signal] = await once(child, 'exit'); expect(signal).toBe('SIGKILL');
    const run = book.db.prepare("SELECT id FROM runs WHERE kind = 'draft' ORDER BY rowid DESC LIMIT 1").get() as { id: string };
    const runs = new RunStore(book); expect(runs.attempts(run.id)[0]!.status).toBe('received');
    const result = await new CreationWorkflow(book, runs.get(run.id).config, new FakeProvider([]), budget).resume(run.id);
    expect(result.revision!.content).toContain('进程恢复'); expect(runs.attempts(run.id)).toHaveLength(1);
  });

  it('requires explicit retry after a real process dies with an in-flight request', async () => {
    await preparePlan(); const child = worker('inflight'); await once(child, 'exit');
    const run = book.db.prepare("SELECT id FROM runs WHERE kind = 'draft' ORDER BY rowid DESC LIMIT 1").get() as { id: string }; const runs = new RunStore(book);
    const resume = () => new CreationWorkflow(book, runs.get(run.id).config, new FakeProvider(['明确重试后的正文。']), budget);
    await expect(resume().resume(run.id)).rejects.toThrow('--retry-unknown');
    expect(runs.attempts(run.id)).toHaveLength(1); expect(runs.attempts(run.id)[0]!.status).toBe('unknown');
    await resume().resume(run.id, true); expect(runs.attempts(run.id)).toHaveLength(2); expect(runs.attempts(run.id)[0]!.reservedTokens).toBeGreaterThan(0);
  });

  it('preserves truncation metadata across a crash before output validation', async () => {
    await preparePlan(); const child = worker('response-truncated'); await once(child, 'exit');
    const row = book.db.prepare("SELECT id FROM runs WHERE kind = 'draft' ORDER BY rowid DESC LIMIT 1").get() as { id: string }; const runs = new RunStore(book);
    expect(runs.attempts(row.id)[0]).toMatchObject({ status: 'received', finishReason: 'length', responseModelId: 'fake-v1' });
    await expect(new CreationWorkflow(book, runs.get(row.id).config, new FakeProvider([]), budget).resume(row.id)).rejects.toThrow('截断');
    expect(runs.attempts(row.id)).toHaveLength(1);
    expect(book.db.prepare("SELECT count(*) AS n FROM proposals WHERE kind = 'draft'").get()).toEqual({ n: 0 });
  });

  it('rejects another process while the writer is alive, then recovers its ownership after death', async () => {
    await preparePlan(); const child = worker('hold'); await ready(child);
    const workflow = new CreationWorkflow(book, config, new FakeProvider(['不应消费。']), budget);
    await expect(workflow.draft(1)).rejects.toThrow('持有写入权');
    child.kill('SIGKILL'); await once(child, 'exit');
    const result = await new CreationWorkflow(book, config, new FakeProvider(['新的有效候选。']), budget).draft(1);
    expect(result.revision!.content).toContain('新的有效候选');
  });

  it('fences a delayed response after ownership changes', async () => {
    await preparePlan(); const child = worker('late'); await ready(child);
    book.db.prepare('UPDATE write_lease SET expires_at = 0').run();
    const runs = new RunStore(book); const successor = runs.create('successor', {}, config, budget); const lease = new WriteLease(runs, successor.id); lease.acquire();
    try {
      child.stdin!.end('release'); await once(child, 'exit'); lease.assert();
      expect(book.db.prepare("SELECT count(*) AS n FROM proposals WHERE kind = 'draft'").get()).toEqual({ n: 0 });
    } finally { lease.release(); }
  });

  it('prevents a cancelled process from saving its late result and preserves unknown cost', async () => {
    await preparePlan(); const child = worker('late'); await ready(child);
    const row = book.db.prepare("SELECT id FROM runs WHERE kind = 'draft' ORDER BY rowid DESC LIMIT 1").get() as { id: string }; const runs = new RunStore(book);
    runs.cancel(row.id); child.stdin!.end('release'); await once(child, 'exit');
    expect(runs.get(row.id).status).toBe('cancelled'); expect(runs.attempts(row.id)[0]!.status).toBe('unknown');
    expect(book.db.prepare("SELECT count(*) AS n FROM proposals WHERE kind = 'draft'").get()).toEqual({ n: 0 });
  });

  it('rolls back interrupted transactions and invalidates memory atomically with committed text', async () => {
    await new CommitService(book).importFile('fixtures/novels/harbor-light.md', true);
    const before = book.snapshot(); const first = before.state.chapters[0]!; const revision = book.revision(first.revisionId); const block = blocks(revision.content)[1]!;
    new MemoryStore(book).saveSummary(revision.id, { summary: '旧摘要', evidence: [{ chapterId: first.id, revisionId: revision.id, blockId: block.id, quote: block.text }] });
    const crash = worker('mid-commit'); await once(crash, 'exit');
    expect(book.snapshot()).toEqual(before); expect(book.db.prepare('SELECT count(*) AS n FROM revisions').get()).toEqual({ n: 3 });
    const committed = worker('after-commit'); await once(committed, 'exit');
    expect(book.project().version).toBe(before.version + 1); expect(new MemoryStore(book).entries()[0]!.status).toBe('stale');
    expect(new CommitService(book).replace(first.id, '提交后崩溃的新正文。', before.version, 'crash-commit').version).toBe(before.version + 1);
    expect(book.db.prepare('SELECT count(*) AS n FROM revisions').get()).toEqual({ n: 4 });
  });

  it('rolls back a failed schema migration without leaving a partial table', () => {
    const version = book.db.pragma('user_version', { simple: true }) as number;
    const scripts = [...Array<string>(version).fill(''), 'CREATE TABLE interrupted_migration (id INTEGER); INSERT INTO nonexistent_table VALUES (1);'];
    expect(() => migrateDatabase(book.db, scripts)).toThrow();
    expect(book.db.pragma('user_version', { simple: true })).toBe(version);
    expect(book.db.prepare("SELECT name FROM sqlite_master WHERE name = 'interrupted_migration'").get()).toBeUndefined();
    expect(book.project().title).toBe('故障验收');
  });

  it('rejects run creation from an already changed context snapshot', async () => {
    await preparePlan(); const old = book.project().version;
    new CommitService(book).insert('插章', '作者新增内容。', 1, old);
    expect(() => new RunStore(book).create('draft', {}, config, budget, old)).toThrow('快照已改变');
  });

  it('replays saved outputs through a read-only connection without mutating the database', async () => {
    await preparePlan(); const result = await new CreationWorkflow(book, config, new FakeProvider(['可重放正文。', JSON.stringify({ summary: '未发现问题', issues: [] }), '{"facts":[]}']), budget).write(1);
    new ProposalService(book).approve(result.proposal.id); book.close();
    const before = await readFile(resolve(directory, 'novel.db')); const replay = replayRun(directory, result.runId);
    expect(replay.ok).toBe(true); expect(replay.databaseChanges).toBe(0); expect(replay.qualityEvaluated).toBe(false);
    expect(await readFile(resolve(directory, 'novel.db'))).toEqual(before);
  });
});
