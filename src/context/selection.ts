import { SelectionSchema, PatchPayloadSchema } from '../domain/patch.js';
import { BookStore } from '../storage/book-store.js';
import { ProposalStore } from '../storage/proposal-store.js';
import type { Proposal } from '../storage/proposal-store.js';
import type { ContextSnapshot } from './builder.js';

export function selectionContext(book: BookStore, proposal: Proposal, revisionId: string): ContextSnapshot {
  const selected = SelectionSchema.parse(proposal.payload); const snapshot = book.snapshot(proposal.baseVersion);
  const target = selected.drafts.find(item => item.revisionId === revisionId);
  if (!target) throw new Error('正文不属于该部分采纳结果。');
  const chapter = snapshot.state.chapters.find(item => item.id === target.chapterId);
  if (!chapter) throw new Error('局部修改只能针对已有正式章节。');
  const patch = PatchPayloadSchema.parse(new ProposalStore(book).get(selected.sourceProposalId).payload);
  const plan = { chapterId: chapter.id, revisionId: target.baseRevisionId, ordinal: snapshot.state.chapters.indexOf(chapter) + 1, title: chapter.title, goal: `检查局部修订结果：${patch.instruction}`, characters: snapshot.state.plans[chapter.id]?.characters ?? [], constraints: snapshot.state.constraints, events: [], targetLength: book.revision(revisionId).content.length };
  const sources: ContextSnapshot['sources'] = [{ kind: 'constraint', id: 'author', revisionId: String(snapshot.version), text: JSON.stringify(snapshot.state.constraints), reason: '作者独立约束', estimatedTokens: Buffer.byteLength(JSON.stringify(snapshot.state.constraints)) }];
  for (const item of snapshot.state.chapters) {
    const replacement = selected.drafts.find(draft => draft.chapterId === item.id)?.revisionId ?? item.revisionId;
    const text = book.revision(replacement).content;
    sources.push({ kind: 'chapter', id: item.id, revisionId: replacement, text, reason: '所选修改组实际形成的整本书视图；未选修改不在其中', estimatedTokens: Buffer.byteLength(text) });
  }
  return { projectVersion: snapshot.version, plan, sources, estimatedTokens: sources.reduce((sum, source) => sum + source.estimatedTokens, 0) };
}
