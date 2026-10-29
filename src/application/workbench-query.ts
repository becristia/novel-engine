import type { LoadedConfig } from '../llm/config.js';
import { hostname } from 'node:os';
import { hash } from '../domain/workspace.js';
import { BookStore } from '../storage/book-store.js';
import { ProposalStore } from '../storage/proposal-store.js';
import type { Proposal } from '../storage/proposal-store.js';
import { RunStore } from '../storage/run-store.js';
import { ReviewStore } from '../storage/review-store.js';
import { MemoryStore, SummarySchema } from '../storage/memory-store.js';
import { DraftPayloadSchema } from '../domain/planning.js';
import { SelectionSchema, PatchPayloadSchema } from '../domain/patch.js';
import { FactSchema, ReviewSchema, ExtractionSchema } from '../domain/review.js';
import { blocks, validateReview, validateExtraction } from '../review/evidence.js';
import { PatchService } from '../proposals/patches.js';
import { isSupportedNode } from '../cli/doctor.js';
import { publicError } from './workbench-errors.js';

export function approvalState(book: BookStore, proposal: Proposal) {
  let requiresReason = false;
  let blockedCode = 'needs-review';
  try {
    if (proposal.status !== 'pending') { blockedCode = 'processed'; throw new Error('提案已经处理，不能再次批准。'); }
    if (proposal.baseVersion !== book.project().version) { blockedCode = 'stale'; throw new Error('候选基线已过期，请重新准备。'); }
    if (new RunStore(book).get(proposal.runId).cancelled) { blockedCode = 'cancelled'; throw new Error('运行已取消，不能批准。'); }
    if (proposal.kind === 'patch') throw new Error('需要先选择修改组并生成候选。');
    if (proposal.kind !== 'plan') {
      const state = book.snapshot().state;
      const revisions = proposal.kind === 'draft' ? [DraftPayloadSchema.parse(proposal.payload).revisionId] : SelectionSchema.parse(proposal.payload).drafts.map(item => item.revisionId);
      let allowed = new Set([...state.chapters.map(item => item.revisionId), ...revisions]);
      if (proposal.kind === 'selection') {
        const selected = SelectionSchema.parse(proposal.payload);
        const source = new ProposalStore(book).get(selected.sourceProposalId);
        if (source.status !== 'pending' || source.baseVersion !== proposal.baseVersion) throw new Error('原修改提案已经过期。');
        new PatchService(book).preview(source.id, selected.groupIds);
        allowed = new Set(state.chapters.map(item => selected.drafts.find(draft => draft.chapterId === item.id)?.revisionId ?? item.revisionId));
      } else {
        const draft = DraftPayloadSchema.parse(proposal.payload);
        if (state.plans[draft.chapterId]?.revisionId !== draft.planRevisionId) throw new Error('计划版本已经过期。');
      }
      for (const id of revisions) {
        const reports = new ReviewStore(book).approvedReports(id, proposal.baseVersion);
        validateReview(book, reports.review, allowed); validateExtraction(book, reports.extraction, id);
        if (reports.review.issues.some(issue => issue.kind === 'conflict')) { blockedCode = 'conflict'; throw new Error('存在确定冲突，请修订并重新审稿。'); }
        requiresReason ||= reports.review.issues.length > 0;
      }
    }
    return { canApprove: true, requiresReason, blockedReason: null, blockedCode: null };
  } catch (error) { return { canApprove: false, requiresReason, blockedReason: publicError(error).message, blockedCode }; }
}

export function revisionView(book: BookStore, id: string) {
  const revision = book.revision(id); const reports = new ReviewStore(book);
  const review = reports.latest('reviews', id); const extraction = reports.latest('extractions', id);
  return {
    ...revision, blocks: blocks(revision.content),
    review: review ? { ...review, payload: review.status === 'reviewed' ? ReviewSchema.parse(JSON.parse(review.payload)) : null } : null,
    extraction: extraction ? { ...extraction, payload: extraction.status === 'extracted' ? ExtractionSchema.parse(JSON.parse(extraction.payload)) : null } : null,
  };
}

export function runView(book: BookStore, id: string) {
  const runs = new RunStore(book); const run = runs.get(id);
  const lease = book.db.prepare('SELECT run_id AS runId, expires_at AS expiresAt, pid, hostname FROM write_lease WHERE singleton = 1').get() as { runId: string; expiresAt: number; pid: number; hostname: string } | undefined;
  let active = Boolean(lease?.runId === id && lease.expiresAt > Date.now());
  if (active && lease?.hostname === hostname()) {
    try { if (!Number.isSafeInteger(lease.pid) || lease.pid < 1) active = false; else process.kill(lease.pid, 0); }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ESRCH') active = false; }
  }
  const interrupted = !active && ['queued', 'running'].includes(run.status);
  const result = runs.artifact(id, 'result') as { proposalId?: string; revisionId?: string } | undefined;
  const attempts = runs.attempts(id).map(({ prompt: _prompt, raw: _raw, usage, ...attempt }) => ({ ...attempt, usage: usage ? JSON.parse(usage) as { inputTokens: number; outputTokens: number } : null }));
  const input = run.input as { chapter?: number; brief?: string; chapters?: number; sourceChapterId?: string; context?: { plan?: { title: string } } };
  return {
    id, kind: run.kind, status: run.status, baseVersion: run.baseVersion, cancelled: run.cancelled,
    error: run.error, budget: run.budget, chapter: input.chapter ?? null, title: input.context?.plan?.title ?? null, brief: input.brief ?? null, chapters: input.chapters ?? null,
    sourceChapterId: input.sourceChapterId ?? null, modelId: run.config.model.modelId, configurationHash: hash(JSON.stringify(run.config.model)), attempts,
    active, interrupted, proposalId: typeof result?.proposalId === 'string' ? result.proposalId : null,
    reservedTokens: attempts.reduce((sum, item) => sum + (item.usage ? item.usage.inputTokens + item.usage.outputTokens : item.reservedTokens), 0),
    estimatedCost: attempts.length && attempts.every(item => item.estimatedCost !== null) ? attempts.reduce((sum, item) => sum + item.estimatedCost!, 0) : null,
    hasUnknown: attempts.some(item => item.status === 'unknown' || (item.status === 'inflight' && (run.status !== 'running' || interrupted))),
  };
}

export function workspaceView(book: BookStore) {
  return book.db.transaction(() => {
    const snapshot = book.snapshot(); const proposals = new ProposalStore(book).list();
    const runs = (book.db.prepare('SELECT id, created_at AS createdAt FROM runs ORDER BY rowid DESC').all() as { id: string; createdAt: string }[]).map(row => ({ ...runView(book, row.id), createdAt: row.createdAt }));
    const memory = new MemoryStore(book).entries().map(entry => ({
      ...entry,
      sourceChapterId: book.revision(entry.revisionId).chapterId,
      fact: entry.kind === 'fact' ? FactSchema.parse(JSON.parse(entry.payload)) : null,
      summary: entry.kind === 'summary' ? SummarySchema.parse(JSON.parse(entry.payload)) : null,
      eligible: entry.kind === 'fact' && entry.status === 'fresh' && snapshot.state.confirmedFactIds.includes(entry.id),
    }));
    return {
      project: book.project(), snapshot,
      proposals: proposals.map(proposal => ({ ...proposal, approval: approvalState(book, proposal), stale: proposal.baseVersion !== snapshot.version })),
      runs, memory,
      memorySources: book.db.prepare('SELECT revision_id AS revisionId, content_hash AS contentHash, status FROM memory_sources').all() as { revisionId: string; contentHash: string; status: string }[],
      versions: book.db.prepare('SELECT version, created_at AS createdAt FROM snapshots ORDER BY version DESC').all() as { version: number; createdAt: string }[],
      patches: proposals.filter(item => item.kind === 'patch').map(item => ({ ...item, payload: PatchPayloadSchema.parse(item.payload) })),
    };
  }).deferred();
}

export function configurationView(loaded: LoadedConfig) {
  const model = loaded.config.model;
  const credentialAvailable = model.provider === 'fake' || Boolean(process.env[model.apiKeyEnv]);
  return {
    source: loaded.source, provider: model.provider, modelId: model.modelId,
    configurationHash: hash(JSON.stringify(model)),
    baseURL: model.provider === 'openai-compatible' ? model.baseURL : null,
    apiKeyEnv: model.provider === 'openai-compatible' ? model.apiKeyEnv : null,
    credentialAvailable, hasFakeResponses: model.provider === 'fake' && Boolean(model.responsesFile), prices: model.prices ?? null,
    maxOutputTokens: model.maxOutputTokens, contextWindowTokens: model.contextWindowTokens,
    nodeVersion: process.versions.node, offlineOk: isSupportedNode(process.versions.node),
  };
}
export type WorkspaceView = ReturnType<typeof workspaceView>;
export type RevisionView = ReturnType<typeof revisionView>;
export type RunView = ReturnType<typeof runView>;
export type ConfigurationView = ReturnType<typeof configurationView>;
