import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookStore } from '../src/storage/book-store.js';
import { createWorkspace, CommitService } from '../src/application/workspace.js';
import { StoryStore } from '../src/storage/story-store.js';
import { emptyStory } from '../src/domain/story-memory.js';
import { MemoryJobStore } from '../src/storage/memory-jobs.js';
import { HindsightAdapter, HindsightHttpTransport, bankId, documentId, createHindsightAdapter, hindsightStatus, syncHindsightJob, resolveRetrievalHits } from '../src/context/hindsight.js';
import type { RetrievalSource } from '../src/context/hindsight.js';
import { blocks } from '../src/review/evidence.js';
import type { ContextSnapshot } from '../src/context/builder.js';

describe('optional Hindsight contract, never a fact authority', () => {
  let book: BookStore; let directory: string;
  beforeEach(async () => {
    await mkdir('.tmp/story-memory-tests', { recursive: true }); directory = await mkdtemp(resolve('.tmp/story-memory-tests/hindsight-'));
    createWorkspace(directory, '检索验收'); book = new BookStore(directory); await new CommitService(book).importFile('fixtures/novels/harbor-light.md', true); new StoryStore(book).save(emptyStory(), 1);
  });
  afterEach(async () => { book.close(); await rm(directory, { recursive: true }); });
  const source = (): RetrievalSource => { const chapter = book.snapshot().state.chapters[0]!; return { id: 'allowed-quote', projectId: book.project().id, revisionId: chapter.revisionId, contentHash: book.revision(chapter.revisionId).contentHash }; };
  const signal = () => new AbortController().signal;
  it('has no constructor requests and keeps the product factory closed without real admission evidence', () => {
    const send = vi.fn(); new HindsightHttpTransport('http://127.0.0.1:8888', send); expect(send).not.toHaveBeenCalled();
    expect(hindsightStatus.enabled).toBe(false); expect(() => createHindsightAdapter('http://127.0.0.1:8888')).toThrow('未通过');
  });
  it('C14 returns only allowed current source identities and ignores generated service prose', async () => {
    const allowed = source(); const raw = (item: RetrievalSource) => ({ document_id: documentId(item), text: '服务推测顾宁是真凶，不可注入正文。', metadata: { project_id: item.projectId, revision_id: item.revisionId, content_hash: item.contentHash }, scores: { final: 0.9 } });
    const request = vi.fn(async () => ({ results: [raw({ ...allowed, projectId: 'another-book' }), raw({ ...allowed, revisionId: 'old' }), raw(allowed), { document_id: 'fake' }] }));
    const result = await new HindsightAdapter({ request }).recall(allowed.projectId, '信封的线索', [allowed], 1000, signal());
    expect(result).toEqual({ hits: [{ sourceId: allowed.id, revisionId: allowed.revisionId, contentHash: allowed.contentHash, score: 0.9 }], rejected: 3 });
    expect(JSON.stringify(result)).not.toContain('真凶'); expect(request.mock.calls[0]).toBeDefined();
  });
  it('C12 does not request empty source sets, pre-cancelled work or retry a 503', async () => {
    const request = vi.fn(async () => ({ results: [] })); const adapter = new HindsightAdapter({ request });
    await adapter.recall(book.project().id, '线索', [], 100, signal()); expect(request).not.toHaveBeenCalled();
    const abort = new AbortController(); abort.abort(); await expect(adapter.recall(book.project().id, '线索', [source()], 100, abort.signal)).rejects.toThrow(); expect(request).not.toHaveBeenCalled();
    const send = vi.fn<typeof fetch>(async () => new Response('private-config-secret', { status: 503 }));
    const http = new HindsightHttpTransport('http://127.0.0.1:8888', send);
    await expect(http.request('POST', '/v1/default/banks/test/memories/recall', {}, signal())).rejects.toThrow('没有自动重试'); expect(send).toHaveBeenCalledTimes(1);
  });
  it('validates endpoint and response limits without exposing remote bodies', async () => {
    expect(() => new HindsightHttpTransport('https://user:secret@example.com/')).toThrow('地址');
    const send = vi.fn<typeof fetch>(async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)));
    await expect(new HindsightHttpTransport('http://localhost:8888', send).request('GET', '/v1/default/banks/test/operations/x', undefined, signal())).rejects.toThrow('未确认');
  });
  it('discards a response received after cancellation', async () => {
    const controller = new AbortController(); const adapter = new HindsightAdapter({ request: async () => { controller.abort(); return { results: [] }; } });
    await expect(adapter.recall(book.project().id, '线索', [source()], 100, controller.signal)).rejects.toThrow();
  });
  it('C11 and C12 records operation identity before sending and recovers by querying, without a duplicate retain', async () => {
    const jobs = new MemoryJobStore(book); const job = jobs.list()[0]!; let retained = 0; let queried = 0;
    const adapter = new HindsightAdapter({ request: async (method, path, body) => {
      if (method === 'POST') { retained += 1; expect(jobs.get(job.id).externalId).toBe((body as { operation_id: string }).operation_id); throw new Error('simulated-disconnect'); }
      queried += 1; return { operation_id: path.split('/').at(-1), status: 'completed' };
    } });
    await expect(syncHindsightJob(book, job.id, adapter, signal())).rejects.toThrow('simulated-disconnect');
    expect(jobs.get(job.id).status).toBe('unknown');
    expect((await syncHindsightJob(book, job.id, adapter, signal())).status).toBe('succeeded');
    await syncHindsightJob(book, job.id, adapter, signal()); expect(retained).toBe(1); expect(queried).toBe(1); expect(book.project().version).toBe(2);
  });
  it('binds retain namespace, immutable document and source hash; late indexing cannot promote a fact', async () => {
    const jobs = new MemoryJobStore(book); const job = jobs.list()[0]!;
    const adapter = new HindsightAdapter({ request: async (method, path, value) => {
      if (method === 'POST') {
        const body = value as { operation_id: string; items: { timestamp: string; document_id: string }[] };
        expect(body.items[0]!.timestamp).toBe('unset'); expect(path).toContain(bankId(book.project().id));
        new CommitService(book).replace(book.snapshot().state.chapters[0]!.id, '## 后来\n\n改变了正文。', book.project().version);
        return { success: true, bank_id: bankId(book.project().id), async: true, operation_id: body.operation_id };
      }
      return { operation_id: path.split('/').at(-1), status: 'completed' };
    } });
    expect((await syncHindsightJob(book, job.id, adapter, signal())).status).toBe('obsolete'); expect(book.snapshot().state.story!.claims).toEqual([]);
  });
  it('resolves local quotations again and rejects obsolete contexts or disallowed identities', () => {
    const allowed = source(); const revision = book.revision(allowed.revisionId); const block = blocks(revision.content)[1]!;
    const reference = { kind: 'text' as const, chapterId: revision.chapterId, revisionId: revision.id, contentHash: revision.contentHash, blockId: block.id, quote: block.text };
    const context: ContextSnapshot = { projectVersion: book.project().version, plan: { chapterId: revision.chapterId, revisionId: 'plan', ordinal: 1, title: '检索', goal: '核对', characters: [], constraints: [], events: [], targetLength: 100 }, estimatedTokens: 100, sources: [{ id: allowed.id, kind: 'text-range', revisionId: revision.id, text: '缓存内容不能替换原文', estimatedTokens: 1, reason: 'allowed', reference }] };
    const hit = { sourceId: allowed.id, revisionId: allowed.revisionId, contentHash: allowed.contentHash, score: null };
    expect(resolveRetrievalHits(book, context, [hit])[0]!.text).toBe(block.text); expect(resolveRetrievalHits(book, context, [{ ...hit, sourceId: 'fake' }])).toEqual([]);
    new CommitService(book).replace(revision.chapterId, '## 新稿\n\n正文。', book.project().version);
    expect(() => resolveRetrievalHits(book, context, [hit])).toThrow('过期');
  });
});
