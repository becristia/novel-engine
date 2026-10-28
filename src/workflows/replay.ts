import { z } from 'zod';
import { hash } from '../domain/workspace.js';
import { PlannerOutputSchema } from '../domain/planning.js';
import { ReviewSchema, ExtractionSchema } from '../domain/review.js';
import { ImpactSchema, SelectionSchema, PatchPayloadSchema } from '../domain/patch.js';
import { ContextSchema } from '../context/builder.js';
import { BookStore } from '../storage/book-store.js';
import { RunStore } from '../storage/run-store.js';
import { ProposalStore } from '../storage/proposal-store.js';
import { SummarySchema } from '../storage/memory-store.js';
import { resolveReference, validateReview, validateExtraction } from '../review/evidence.js';
import { normalizeImpact, previewGroups } from '../proposals/patches.js';

export function replayRun(directory: string, id: string) {
  const book = new BookStore(directory, false, true);
  try {
    return book.db.transaction(() => {
    const runs = new RunStore(book); const run = runs.get(id); const attempts = runs.attempts(id);
    const input = run.input as { context?: unknown; revisionIds?: string[] };
    const context = input.context === undefined ? undefined : ContextSchema.parse(input.context);
    const checks: { target: string; ok: boolean; result: string }[] = [];
    if (context) {
      checks.push({ target: 'input-snapshot', ok: context.projectVersion === run.baseVersion, result: '记录上下文的项目版本与运行基线比较' });
      for (const source of context.sources.filter(item => item.kind === 'chapter')) {
        checks.push({ target: `source:${source.id}`, ok: book.revision(source.revisionId).content === source.text, result: '不可变正文来源比较' });
      }
    }
    const unresolved = attempts.filter(attempt => attempt.status === 'unknown' || attempt.status === 'inflight').map(attempt => attempt.id);
    for (const attempt of attempts) {
      const fingerprint = hash(JSON.stringify({ prompt: attempt.prompt, maxOutputTokens: attempt.maxOutputTokens, model: run.config.model }));
      checks.push({ target: `${attempt.id}:input`, ok: fingerprint === attempt.inputHash, result: '请求输入摘要比较' });
      if (attempt.raw === null) { checks.push({ target: attempt.id, ok: attempt.status === 'failed', result: '没有可重放的原始响应；不会请求远端' }); continue; }
      let valid = true;
      try {
        if (attempt.finishReason === 'length' || attempt.finishReason === 'content-filter') throw new Error('incomplete-output');
        if (attempt.step === 'plan:v1') PlannerOutputSchema.parse(JSON.parse(attempt.raw));
        else if (attempt.step === 'probe:v1') z.strictObject({ ok: z.literal(true) }).parse(JSON.parse(attempt.raw));
        else if (attempt.step.startsWith('review:')) {
          const revisionId = attempt.step.slice('review:'.length);
          const allowed = new Set([...(context?.sources.filter(source => !['constraint', 'plan'].includes(source.kind)).map(source => source.revisionId) ?? []), revisionId]);
          validateReview(book, ReviewSchema.parse(JSON.parse(attempt.raw)), allowed);
        } else if (attempt.step.startsWith('extract:') || attempt.step.startsWith('memory-facts:')) {
          const revisionId = attempt.step.slice(attempt.step.indexOf(':') + 1);
          validateExtraction(book, ExtractionSchema.parse(JSON.parse(attempt.raw)), revisionId);
        } else if (attempt.step.startsWith('memory-summary:')) {
          const revisionId = attempt.step.slice('memory-summary:'.length); const summary = SummarySchema.parse(JSON.parse(attempt.raw));
          summary.evidence.forEach(reference => resolveReference(book, reference, new Set([revisionId])));
        } else if (attempt.step === 'impact:v1') normalizeImpact(book, ImpactSchema.parse(JSON.parse(attempt.raw)), new Set(input.revisionIds));
        else if (!attempt.raw.trim()) throw new Error('empty-output');
      } catch { valid = false; }
      const recordedFailure = attempt.status === 'failed';
      checks.push({ target: attempt.id, ok: recordedFailure ? !valid || attempt.error === 'incomplete-output' : valid, result: valid ? '原始响应通过当前解析与引用校验' : '重放发现无效输出或引用；不表示写作质量通过' });
    }
    const proposals = new ProposalStore(book);
    for (const proposal of proposals.list().filter(item => item.runId === id && item.kind === 'selection')) {
      const selected = SelectionSchema.parse(proposal.payload); const source = PatchPayloadSchema.parse(proposals.get(selected.sourceProposalId).payload);
      const calculated = previewGroups(book, source, selected.groupIds, book.snapshot(proposal.baseVersion).state);
      for (const draft of selected.drafts) checks.push({ target: draft.revisionId, ok: calculated.find(item => item.chapterId === draft.chapterId)?.after === book.revision(draft.revisionId).content, result: '重新计算所选修改组的实际正文' });
    }
    const changes = book.db.prepare('SELECT total_changes() AS count').get() as { count: number };
    return { runId: id, originalStatus: run.status, offline: true, readOnly: true, ok: unresolved.length === 0 && checks.every(check => check.ok), unresolved, checks, databaseChanges: changes.count, qualityEvaluated: false };
    }).deferred();
  } finally { book.close(); }
}
