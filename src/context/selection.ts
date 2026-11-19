import { SelectionSchema, PatchPayloadSchema } from '../domain/patch.js';
import { BookStore } from '../storage/book-store.js';
import { ProposalStore } from '../storage/proposal-store.js';
import type { Proposal } from '../storage/proposal-store.js';
import type { ContextSnapshot } from './builder.js';
import { activeStory, storySource } from './story-builder.js';
import { invalidateStory } from '../storage/story-invalidation.js';

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
  if (snapshot.state.story) {
    const projected = structuredClone(snapshot.state); projected.story = activeStory(book, snapshot.version);
    for (const chapter of projected.chapters) chapter.revisionId = selected.drafts.find(draft => draft.chapterId === chapter.id)?.revisionId ?? chapter.revisionId;
    invalidateStory(snapshot.state, projected);
    sources.push(storySource('story-state', 'story', String(snapshot.version), JSON.stringify(projected.story), '审查实际选择结果及其故事依赖；替换来源已经标记失效，不得转交 Writer'));
  }
  return { ...(snapshot.state.story ? { protocolVersion: 'story-v1' as const, ruleVersion: 'story-rules-v1' as const, task: 'reviewer' as const } : {}), projectVersion: snapshot.version, plan, sources, estimatedTokens: sources.reduce((sum, source) => sum + source.estimatedTokens, 0) };
}
