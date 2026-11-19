import { z } from 'zod';
import { hash } from '../domain/workspace.js';
import type { BookStore } from '../storage/book-store.js';
import { MemoryJobStore } from '../storage/memory-jobs.js';
import type { ContextSnapshot } from './builder.js';
import { resolveReference } from '../review/evidence.js';

export const hindsightStatus = {
  provider: 'hindsight', reviewedVersion: '1.1.0', enabled: false,
  checks: { contract: 'offline-tested', serviceRestart: 'not-tested', chineseRetrieval: 'not-tested', internalCallBudget: 'not-tested', cancellation: 'contract-only', usageAccounting: 'not-tested' },
  fallback: 'local-scene-rules',
} as const;

export interface RetrievalSource { id: string; projectId: string; revisionId: string; contentHash: string }
export interface RetrievalHit { sourceId: string; revisionId: string; contentHash: string; score: number | null }
export interface HindsightTransport { request(method: 'GET' | 'POST' | 'DELETE', path: string, body: unknown, signal: AbortSignal): Promise<unknown> }
export class HindsightHttpTransport implements HindsightTransport {
  private readonly endpoint: string;
  constructor(baseURL: string, private readonly send: typeof fetch = (...args) => fetch(...args), private readonly timeoutMs = 30000) {
    let url: URL;
    try { url = new URL(baseURL); } catch { throw new Error('检索服务地址无效。'); }
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('检索服务地址或超时配置无效。');
    this.endpoint = url.origin;
  }
  async request(method: 'GET' | 'POST' | 'DELETE', path: string, body: unknown, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    if (!path.startsWith('/v1/default/banks/')) throw new Error('检索接口路径不受支持。');
    const combined = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]);
    try {
      const response = await this.send(`${this.endpoint}${path}`, { method, redirect: 'error', signal: combined, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!response.ok) throw new Error('remote-status');
      const reader = response.body?.getReader(); if (!reader) throw new Error('empty-body');
      const chunks: Uint8Array[] = []; let length = 0;
      try { while (true) { combined.throwIfAborted(); const next = await reader.read(); if (next.done) break; length += next.value.length; if (length > 2 * 1024 * 1024) throw new Error('oversized-response'); chunks.push(next.value); } }
      finally { await reader.cancel(); }
      combined.throwIfAborted(); return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch { throw new Error('检索请求未确认完成；没有自动重试，外部费用保持未知。'); }
  }
}
const RecallSchema = z.object({ results: z.array(z.object({ document_id: z.string().nullable().optional(), metadata: z.record(z.string(), z.string()).nullable().optional(), scores: z.object({ final: z.number().finite() }).nullable().optional() })).max(10000) });
const RetainSchema = z.object({ success: z.literal(true), bank_id: z.string(), async: z.literal(true), operation_id: z.string().min(1) });
const OperationSchema = z.object({ operation_id: z.string(), status: z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled', 'not_found']) });

export const bankId = (projectId: string) => `novel-${hash(projectId).slice(0, 32)}`;
export const documentId = (source: RetrievalSource) => `${bankId(source.projectId)}:${source.revisionId}:${source.contentHash}`;
export function operationId(jobId: string) {
  const digest = hash(jobId); return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

// No constructor discovery, telemetry, retries or background workers. The product
// factory stays closed until real-service and complete internal-cost gates pass.
export class HindsightAdapter {
  constructor(readonly transport: HindsightTransport) {}
  async recall(projectId: string, query: string, allowed: readonly RetrievalSource[], maxTokens: number, signal: AbortSignal) {
    signal.throwIfAborted();
    if (!query.trim() || Buffer.byteLength(query) > 500 || !Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192) throw new Error('检索参数超出范围。');
    const scoped = allowed.filter(source => source.projectId === projectId);
    if (!scoped.length) return { hits: [] as RetrievalHit[], rejected: 0 };
    const response = await this.transport.request('POST', `/v1/default/banks/${bankId(projectId)}/memories/recall`, {
      query, types: ['world', 'experience'], budget: 'low', max_tokens: maxTokens, prefer_observations: false,
      include: { entities: null, chunks: null, source_facts: null },
      tags: [...new Set(scoped.map(source => `source:${documentId(source)}`))], tags_match: 'any_strict',
    }, signal);
    signal.throwIfAborted();
    const parsed = RecallSchema.parse(response); const hits = new Map<string, RetrievalHit>(); let rejected = 0;
    for (const result of parsed.results) {
      const matches = scoped.filter(source => documentId(source) === result.document_id && result.metadata?.project_id === projectId && result.metadata.revision_id === source.revisionId && result.metadata.content_hash === source.contentHash);
      if (!matches.length) { rejected += 1; continue; }
      for (const match of matches) if (!hits.has(match.id)) hits.set(match.id, { sourceId: match.id, revisionId: match.revisionId, contentHash: match.contentHash, score: result.scores?.final ?? null });
    }
    // Service-generated text is intentionally absent from this contract.
    return { hits: [...hits.values()], rejected };
  }
  async retain(source: RetrievalSource, content: string, externalId: string, signal: AbortSignal) {
    signal.throwIfAborted();
    if (hash(content) !== source.contentHash) throw new Error('检索入库来源哈希不匹配。');
    const bank = bankId(source.projectId);
    const raw = await this.transport.request('POST', `/v1/default/banks/${bank}/memories`, {
      async: true, operation_id: externalId,
      items: [{ content, timestamp: 'unset', document_id: documentId(source), metadata: { project_id: source.projectId, revision_id: source.revisionId, content_hash: source.contentHash }, tags: [`source:${documentId(source)}`], resolve_entities: false }],
    }, signal);
    signal.throwIfAborted(); const result = RetainSchema.parse(raw);
    if (result.bank_id !== bank || result.operation_id !== externalId) throw new Error('检索服务返回的操作身份不匹配。');
    return result.operation_id;
  }
  async operation(projectId: string, externalId: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const result = OperationSchema.parse(await this.transport.request('GET', `/v1/default/banks/${bankId(projectId)}/operations/${encodeURIComponent(externalId)}`, undefined, signal));
    signal.throwIfAborted(); if (result.operation_id !== externalId) throw new Error('检索操作身份不匹配。'); return result.status;
  }
  async cancel(projectId: string, externalId: string, signal: AbortSignal) {
    signal.throwIfAborted();
    await this.transport.request('DELETE', `/v1/default/banks/${bankId(projectId)}/operations/${encodeURIComponent(externalId)}`, undefined, signal);
    // Cancellation is cooperative. Acknowledgement is not a zero-cost guarantee.
    return this.operation(projectId, externalId, signal);
  }
}

export function createHindsightAdapter(_baseURL: string): HindsightAdapter {
  throw new Error('检索服务未通过真实持久化、中文召回和内部预算准入，继续使用本地上下文。');
}

export function resolveRetrievalHits(book: BookStore, context: ContextSnapshot, hits: readonly RetrievalHit[]) {
  if (context.projectVersion !== book.project().version) throw new Error('检索上下文版本已经过期。');
  const current = new Set(book.snapshot().state.chapters.map(item => item.revisionId));
  return hits.flatMap(hit => {
    const item = context.sources.find(source => source.id === hit.sourceId && source.reference?.kind === 'text' && source.reference.revisionId === hit.revisionId && source.reference.contentHash === hit.contentHash);
    if (!item || item.reference?.kind !== 'text' || !current.has(hit.revisionId)) return [];
    const reference = resolveReference(book, item.reference, current);
    return [{ ...item, text: reference.quote }];
  });
}

// Called only by an explicitly admitted task runner; no page or constructor calls it.
export async function syncHindsightJob(book: BookStore, id: string, adapter: HindsightAdapter, signal: AbortSignal) {
  signal.throwIfAborted(); const jobs = new MemoryJobStore(book); let job = jobs.get(id);
  if (['succeeded', 'obsolete'].includes(job.status)) return job;
  if (!['unknown', 'inflight'].includes(job.status)) {
    job = jobs.begin(id); const externalId = operationId(job.id);
    jobs.recordOperation(id, externalId); // Persist BEFORE sending; even a lost acknowledgement is queryable.
    try {
      const revision = book.revision(job.sourceId);
      await adapter.retain({ id: job.id, projectId: book.project().id, revisionId: revision.id, contentHash: job.contentHash }, revision.content, externalId, signal);
    } catch (error) { jobs.finish(id, 'unknown'); throw error; }
  }
  job = jobs.get(id);
  if (!job.externalId) throw new Error('记忆同步结果未知且缺少操作身份，不能重发。');
  try {
    const state = await adapter.operation(book.project().id, job.externalId, signal);
    if (state === 'completed') return jobs.finish(id, 'succeeded');
    // A failed upstream operation may have incurred usage. Do not resubmit it.
    return jobs.finish(id, 'unknown');
  } catch (error) { jobs.finish(id, 'unknown'); throw error; }
}
