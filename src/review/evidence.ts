import type { Reference, Review, Extraction } from '../domain/review.js';
import { BookStore } from '../storage/book-store.js';
import { validateStoryChanges } from './story-extraction.js';

export function blocks(content: string) {
  return [...content.matchAll(/[^\n]+/gu)].filter(match => match[0].trim()).map((match, index) => ({ id: `b${index + 1}`, start: match.index, end: match.index + match[0].length, text: match[0] }));
}

export function resolveReference(book: BookStore, reference: Reference, allowed: ReadonlySet<string>): Reference {
  if (!allowed.has(reference.revisionId)) throw new Error('引用来源不在本次正式快照和目标候选中。');
  const revision = book.revision(reference.revisionId);
  if (revision.chapterId !== reference.chapterId || (reference.contentHash !== undefined && reference.contentHash !== revision.contentHash)) throw new Error('引用的章节或原文哈希不匹配。');
  const block = blocks(revision.content).find(item => item.id === reference.blockId);
  if (!block) throw new Error('引用区块不存在。');
  let start = reference.start;
  let end = reference.end;
  if ((start === undefined) !== (end === undefined)) throw new Error('引用偏移必须同时提供起止位置。');
  if (start === undefined) {
    const first = block.text.indexOf(reference.quote);
    if (first < 0 || block.text.indexOf(reference.quote, first + 1) >= 0) throw new Error('引用原文不存在或定位不唯一。');
    start = block.start + first; end = start + reference.quote.length;
  }
  if (start < block.start || end! > block.end || end! <= start || revision.content.slice(start, end) !== reference.quote) throw new Error('引用偏移与原文不一致。');
  return { ...reference, start, end: end!, contentHash: revision.contentHash };
}

export function validateReview(book: BookStore, report: Review, allowed: ReadonlySet<string>): Review {
  if (new Set(report.issues.map(issue => issue.id)).size !== report.issues.length) throw new Error('审稿问题 ID 重复。');
  return { ...report, issues: report.issues.map(issue => ({ ...issue, evidence: issue.evidence.map(reference => resolveReference(book, reference, allowed)) })) };
}

export function validateExtraction(book: BookStore, report: Extraction, revisionId: string): Extraction {
  const allowed = new Set([revisionId]);
  return { ...(report.story ? { story: validateStoryChanges(book, report.story, revisionId, book.project().version) } : {}), facts: report.facts.map(fact => {
    if (fact.kind === 'belief' && !fact.characterId) throw new Error('角色误信必须指明角色。');
    return { ...fact, evidence: resolveReference(book, fact.evidence, allowed) };
  }) };
}
