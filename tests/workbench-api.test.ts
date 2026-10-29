import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Library } from '../src/server/library.js';
import { createWorkbenchApp } from '../src/server/app.js';
import { defaultConfig } from '../src/domain/model-config.js';
import { FakeProvider } from '../src/llm/fake-provider.js';
import { RequestFailure } from '../src/llm/request-failure.js';
import type { TextTransport } from '../src/llm/sdk-provider.js';
import type { ModelResult } from '../src/llm/model-gateway.js';
import { BookStore } from '../src/storage/book-store.js';
import { RunStore } from '../src/storage/run-store.js';
import { createWorkspace } from '../src/application/workspace.js';
import type { WorkspaceView } from '../src/application/workbench-query.js';
import { workspaceView } from '../src/application/workbench-query.js';

const origin = 'http://127.0.0.1:3917';
const budget = { maxRequests: 8, maxTokens: 64000 };
const chapterPlan = { title: '归港', goal: '发现旧信', characters: ['林舟'], constraints: [], events: ['旧信'], targetLength: 1000 };

describe('local workbench boundary and workflows', () => {
  let directory: string; let library: Library; let app: ReturnType<typeof createWorkbenchApp>; let token: string; let id: string;
  let scripts: string[][]; let transportOverride: TextTransport | undefined;
  const factory = vi.fn(async () => transportOverride ?? new FakeProvider(scripts.shift() ?? []));
  const config = defaultConfig();
  const call = (path: string, method = 'GET', value?: unknown, extra: Record<string, string> = {}) => app.handle(new Request(`${origin}/api${path}`, {
    method, headers: { host: '127.0.0.1:3917', origin, 'x-novel-token': token, ...(value === undefined ? {} : { 'content-type': 'application/json' }), ...extra },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  }));
  const view = async () => await (await call(`/workspaces/${id}`)).json() as WorkspaceView;
  const job = async (input: object) => {
    const response = await call(`/workspaces/${id}/jobs`, 'POST', { budget, expectedVersion: (await view()).project.version, requestId: randomUUID(), ...input });
    expect(response.status).toBe(202); const result = await response.json() as { runId: string }; await app.jobs.idle(); return result.runId;
  };
  const action = (input: object) => call(`/workspaces/${id}/actions`, 'POST', input);
  beforeEach(async () => {
    await mkdir('.tmp/workbench-tests', { recursive: true }); directory = await mkdtemp(resolve('.tmp/workbench-tests/api-'));
    library = new Library(join(directory, 'library')); scripts = []; transportOverride = undefined; factory.mockClear();
    app = createWorkbenchApp({ library, origin: () => origin, config: async () => ({ config, source: 'builtin' }), transport: factory });
    token = (await (await app.handle(new Request(`${origin}/api/session`, { headers: { host: '127.0.0.1:3917' } }))).json() as { token: string }).token;
    id = (await (await call('/workspaces', 'POST', { directory: 'book', title: '验收作品' })).json() as { id: string }).id;
  });
  afterEach(async () => { await app.jobs.idle(); vi.unstubAllEnvs(); await rm(directory, { recursive: true }); });

  it('rejects cross-site, forged host, missing token and invalid JSON without a model request', async () => {
    expect((await call('/session', 'GET', undefined, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('/session', 'GET', undefined, { host: 'evil.example:3917' })).status).toBe(403);
    expect((await call('/workspaces', 'GET', undefined, { 'x-novel-token': 'wrong' })).status).toBe(401);
    expect((await call('/workspaces', 'POST', {})).status).toBe(400);
    expect(factory).not.toHaveBeenCalled();
  });

  it('confines explicit workspace registration to the configured library, including symlinks', async () => {
    createWorkspace(join(directory, 'outside'), '外部作品');
    await symlink(join(directory, 'outside'), join(library.root, 'escape'));
    expect((await call('/workspaces', 'POST', { directory: '../outside' })).status).toBe(403);
    expect((await call('/workspaces', 'POST', { directory: 'escape' })).status).toBe(403);
    expect((await call('/workspaces', 'POST', { directory: 'book', title: '覆盖' })).status).toBe(409);
    expect(library.list()).toHaveLength(1);
  });

  it('previews raw uploads, commits once, rejects stale writes and exports the chosen snapshot', async () => {
    const payload = { filename: '稿件.md', content: Buffer.from('## 第一章\n\n归港。\n\n## 第二章\n\n旧信。').toString('base64'), apply: false, expectedVersion: 0 };
    expect((await call(`/workspaces/${id}/import`, 'POST', payload)).status).toBe(200);
    expect((await view()).snapshot.state.chapters).toHaveLength(0);
    expect((await call(`/workspaces/${id}/import`, 'POST', { ...payload, apply: true })).status).toBe(200);
    const current = await view(); expect(current.snapshot.state.chapters).toHaveLength(2);
    expect((await call(`/workspaces/${id}/import`, 'POST', { ...payload, apply: true })).status).toBe(200);
    expect((await view()).project.version).toBe(1);
    const chapterId = current.snapshot.state.chapters[0]!.id;
    expect((await action({ action: 'replace', chapterId, content: '新正文。', expectedVersion: 0, requestId: randomUUID() })).status).toBe(409);
    expect((await action({ action: 'replace', chapterId, content: '新正文。', expectedVersion: 1, requestId: randomUUID() })).status).toBe(200);
    const historical = await call(`/workspaces/${id}/export?version=1&format=markdown`);
    expect(await historical.text()).toContain('归港。');
    expect((await call(`/workspaces/${id}/import`, 'POST', { ...payload, filename: '../escape.md' })).status).toBe(400);
    expect(factory).not.toHaveBeenCalled();
  });

  it('rejects database file symlinks on registration and on later workspace access', async () => {
    const outside = join(directory, 'outside'); createWorkspace(outside, '外部作品');
    const linked = join(library.root, 'linked'); await mkdir(linked);
    await symlink(join(outside, 'novel.db'), join(linked, 'novel.db'));
    expect((await call('/workspaces', 'POST', { directory: 'linked' })).status).toBe(403);
    const registered = join(library.root, 'book', 'novel.db');
    await rename(registered, `${registered}.saved`); await symlink(join(outside, 'novel.db'), registered);
    expect((await call(`/workspaces/${id}`)).status).toBe(403);
    expect(factory).not.toHaveBeenCalled();
  });

  it.each(['novel.db-wal', 'novel.db-shm', 'novel.db-journal'])('rejects a dangling SQLite companion symlink: %s', async filename => {
    await symlink(join(directory, 'outside-data'), join(library.root, 'book', filename));
    expect((await call(`/workspaces/${id}`)).status).toBe(403);
  });

  it('requires explicit nonnegative integer versions for history and export', async () => {
    for (const resource of ['snapshot', 'export']) {
      for (const version of [null, '', ' ', '-1', '1.5', '1e0', 'NaN', '9007199254740992']) {
        const query = new URLSearchParams({ format: 'txt' }); if (version !== null) query.set('version', version);
        expect((await call(`/workspaces/${id}/${resource}?${query}`)).status, `${resource}: ${version}`).toBe(400);
      }
      expect((await call(`/workspaces/${id}/${resource}?version=0&format=txt`)).status).toBe(200);
    }
    expect((await view()).project.version).toBe(0); expect(factory).not.toHaveBeenCalled();
  });

  it('never returns credentials in model configuration', async () => {
    vi.stubEnv('NOVEL_UI_TEST_KEY', 'private-value-never-returned');
    app = createWorkbenchApp({ library, origin: () => origin, config: async () => ({ source: 'example', config: { ...config, model: { provider: 'openai-compatible', modelId: 'example', baseURL: 'https://api.example.com/v1', apiKeyEnv: 'NOVEL_UI_TEST_KEY', maxOutputTokens: 1024, contextWindowTokens: 16384, timeoutMs: 30000 } } }) });
    token = (await (await app.handle(new Request(`${origin}/api/session`, { headers: { host: '127.0.0.1:3917' } }))).json() as { token: string }).token;
    const response = await call('/config'); const text = await response.text();
    expect(text).toContain('"credentialAvailable":true'); expect(text).not.toContain('private-value-never-returned');
  });

  it('rejects oversized and malformed uploaded bytes without changing the workspace', async () => {
    const large = Buffer.alloc(8 * 1024 * 1024 + 1, 'x').toString('base64');
    const base = { filename: 'large.txt', apply: true, expectedVersion: 0 };
    expect((await call(`/workspaces/${id}/import`, 'POST', { ...base, content: large })).status).toBe(413);
    expect((await call(`/workspaces/${id}/import`, 'POST', { ...base, content: '%%%not-base64' })).status).toBe(400);
    expect((await view()).project.version).toBe(0);
  });

  it('discards a late response after cancellation and preserves the unknown attempt', async () => {
    let finish: (result: ModelResult<string>) => void = () => { throw new Error('request not started'); };
    transportOverride = { generateText: () => new Promise(resolveResult => { finish = resolveResult; }) };
    const response = await call(`/workspaces/${id}/jobs`, 'POST', { kind: 'probe', budget, expectedVersion: 0, requestId: randomUUID() });
    const { runId } = await response.json() as { runId: string };
    expect((await action({ action: 'cancel', runId })).status).toBe(200);
    finish({ value: '{"ok":true}', modelId: 'fake-v1', usage: null }); await app.jobs.idle();
    const cancelled = (await view()).runs[0]!;
    expect(cancelled.status).toBe('cancelled'); expect(cancelled.attempts[0]!.status).toBe('unknown');
    expect((await view()).project.version).toBe(0);
  });

  it('completes three chapters through persisted jobs, review and explicit approval', async () => {
    scripts.push([JSON.stringify({ chapters: [chapterPlan, { ...chapterPlan, title: '寻迹' }, { ...chapterPlan, title: '旧灯' }] })]);
    await job({ kind: 'plan', brief: '写三个章节。', chapters: 3 });
    let current = await view(); const plan = current.proposals[0]!;
    expect(plan.approval.canApprove).toBe(true);
    expect((await action({ action: 'approve', proposalId: plan.id, expectedVersion: 0 })).status).toBe(200);
    for (const chapter of [1, 2, 3]) {
      scripts.push([`第 ${chapter} 章正文。`, '{"summary":"无冲突","issues":[]}', '{"facts":[]}']);
      await job({ kind: 'write', chapter });
      current = await view(); const draft = current.proposals.at(-1)!;
      expect(draft.approval.canApprove).toBe(true);
      const before = await (await call(`/workspaces/${id}/export?version=${current.project.version}&format=txt`)).text();
      expect(before).not.toContain(`第 ${chapter} 章正文。`);
      expect((await action({ action: 'approve', proposalId: draft.id, expectedVersion: current.project.version })).status).toBe(200);
    }
    expect((await view()).snapshot.state.chapters).toHaveLength(3);
    expect((await view()).runs.every(run => run.status === 'succeeded')).toBe(true);
  });

  it('coalesces concurrent launches and persists request identity across manager restart', async () => {
    scripts.push(['{"ok":true}']); const input = { kind: 'probe', requestId: randomUUID(), expectedVersion: 0, budget };
    const [left, right] = await Promise.all([app.jobs.start(id, input), app.jobs.start(id, input)]);
    expect(left.runId).toBe(right.runId); await app.jobs.idle(); expect(factory).toHaveBeenCalledTimes(1);
    const next = createWorkbenchApp({ library, origin: () => origin, config: async () => ({ config, source: 'builtin' }), transport: factory });
    expect(await next.jobs.start(id, input)).toEqual(left); expect(factory).toHaveBeenCalledTimes(1);
    await expect(next.jobs.start(id, { ...input, budget: { ...budget, maxRequests: 2 } })).rejects.toThrow('同一请求');
  });

  it('keeps unknown reservations and requires explicit retry without changing the original budget', async () => {
    transportOverride = { generateText: async () => { throw new RequestFailure('unknown', false, 'connection-lost'); } };
    const runId = await job({ kind: 'probe' }); const failed = (await view()).runs[0]!;
    expect(failed.hasUnknown).toBe(true); expect(failed.estimatedCost).toBeNull();
    const originalReservation = failed.reservedTokens;
    const rejected = await call(`/workspaces/${id}/jobs`, 'POST', { kind: 'resume', runId, requestId: randomUUID(), expectedVersion: 0, budget, retryUnknown: false });
    expect(rejected.status).toBe(409);
    transportOverride = new FakeProvider(['{"ok":true}']);
    await job({ kind: 'resume', runId, retryUnknown: true, budget: { maxRequests: 100, maxTokens: 1000000 } });
    const restored = (await view()).runs[0]!;
    expect(restored.status).toBe('succeeded'); expect(restored.budget).toEqual(budget);
    expect(restored.attempts).toHaveLength(2); expect(restored.reservedTokens).toBeGreaterThan(originalReservation);
  });

  it('keeps capability reads side-effect free even when a pending proposal becomes stale', async () => {
    scripts.push([JSON.stringify({ chapters: [chapterPlan] })]); await job({ kind: 'plan', brief: '写一章。', chapters: 1 });
    const book = new BookStore(library.path(id));
    try { book.commit(0, randomUUID(), 'new-constraint', state => { state.constraints.push('作者新约束'); }); } finally { book.close(); }
    const current = await view(); expect(current.proposals[0]!.approval.canApprove).toBe(false);
    expect(current.runs[0]!.status).toBe('awaiting_approval');
    expect((await view()).project.version).toBe(1); expect(factory).toHaveBeenCalledTimes(1);
  });

  it('keeps a candidate readable when a model review fails validation', async () => {
    scripts.push([JSON.stringify({ chapters: [chapterPlan] })]); await job({ kind: 'plan', brief: '写一章。', chapters: 1 });
    const planned = await view();
    await action({ action: 'approve', proposalId: planned.proposals[0]!.id, expectedVersion: 0 });
    scripts.push(['保留可阅读候选。', 'invalid-json', 'invalid-json']); await job({ kind: 'write', chapter: 1 });
    const current = await view(); const draft = current.proposals.at(-1)!.payload as { revisionId: string };
    const response = await call(`/workspaces/${id}/revisions/${draft.revisionId}`);
    expect(response.status).toBe(200);
    const revision = await response.json() as { content: string; review: { status: string; payload: unknown } };
    expect(revision.content).toContain('保留可阅读候选'); expect(revision.review.status).toBe('failed'); expect(revision.review.payload).toBeNull();
  });

  it('reports an orphaned in-flight request as interrupted without mutating its saved status', async () => {
    const book = new BookStore(library.path(id));
    try {
      const runs = new RunStore(book); const run = runs.create('probe', { configSource: 'builtin' }, config, budget);
      runs.reserve(run.id, 'probe:v1', 'saved-hash', 'saved prompt', 128);
    } finally { book.close(); }
    const run = (await view()).runs[0]!;
    expect(run.interrupted).toBe(true); expect(run.active).toBe(false); expect(run.hasUnknown).toBe(true);
    expect(run.status).toBe('running'); expect(run.attempts[0]!.status).toBe('inflight');
  });

  it('returns one coherent snapshot if another connection commits during the overview read', () => {
    const reader = new BookStore(library.path(id), false, true); const writer = new BookStore(library.path(id));
    const original = reader.snapshot.bind(reader);
    vi.spyOn(reader, 'snapshot').mockImplementationOnce(() => {
      const snapshot = original();
      writer.commit(0, randomUUID(), 'concurrent-author-edit', state => { state.constraints.push('刚刚增加的约束'); });
      return snapshot;
    });
    try {
      const result = workspaceView(reader);
      expect(result.project.version).toBe(result.snapshot.version);
      expect(result.project.version).toBe(0); expect(writer.project().version).toBe(1);
    } finally { reader.close(); writer.close(); }
  });
});
