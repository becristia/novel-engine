import type { StoryChanges } from '../domain/review.js';
import { StoryStateSchema } from '../domain/story-memory.js';
import { BookStore } from '../storage/book-store.js';
import { resolveReference } from './evidence.js';
import { hash } from '../domain/workspace.js';

export function validateStoryChanges(book: BookStore, changes: StoryChanges, revisionId: string, version: number): StoryChanges {
  const story = book.snapshot(version).state.story;
  if (!story) throw new Error('记忆变更缺少故事身份字典。');
  const value = structuredClone(changes); const allowed = new Set([revisionId]);
  const prefix = `${revisionId}:${hash(JSON.stringify(changes)).slice(0, 12)}`;
  const remap = Object.fromEntries((['events', 'claims', 'knowledge', 'disclosures', 'threads'] as const).map(collection => [collection, new Map(value[collection].map(item => [item.id, item.id.startsWith(`${revisionId}:`) ? item.id : `${prefix}:${hash(item.id).slice(0, 16)}`]))])) as Record<keyof StoryChanges, Map<string, string>>;
  for (const collection of ['events', 'claims', 'knowledge', 'disclosures', 'threads'] as const) {
    for (const item of value[collection]) {
      if (item.source.kind !== 'text') throw new Error('记忆抽取只能引用本次目标正文。');
      item.source = { ...resolveReference(book, item.source, allowed), kind: 'text', contentHash: book.revision(revisionId).contentHash };
      item.id = remap[collection].get(item.id)!;
    }
  }
  const event = (id: string | null) => id === null ? null : remap.events.get(id) ?? id;
  const claim = (id: string) => remap.claims.get(id) ?? id;
  const corrected = story.claims.filter(item => story.claims.some(other => other.correctsId === item.id));
  const proposition = (item: StoryChanges['claims'][number]) => JSON.stringify({ subjectId: item.subjectId, relation: item.relation, value: item.value, kind: item.kind, holderId: item.holderId, source: item.source });
  for (const item of value.claims) {
    if (item.correctsId !== null || item.confirmed) throw new Error('记忆抽取不能替代作者确认或纠正。');
    item.status = 'pending'; item.fromEventId = event(item.fromEventId); item.untilEventId = event(item.untilEventId);
    item.dependsOn = item.dependsOn.map(key => {
      const split = key.indexOf(':'); const group = key.slice(0, split) as keyof StoryChanges;
      return split >= 0 && remap[group]?.has(key.slice(split + 1)) ? `${group}:${remap[group].get(key.slice(split + 1))}` : key;
    });
    if (corrected.some(original => proposition(original) === proposition(item))) item.status = 'stale';
  }
  for (const item of value.knowledge) { item.claimId = claim(item.claimId); item.learnedAt = event(item.learnedAt); item.untilEventId = event(item.untilEventId); }
  for (const item of value.disclosures) item.claimId = claim(item.claimId);
  for (const item of value.threads) item.claimIds = item.claimIds.map(claim);
  const merged = structuredClone(story);
  for (const collection of ['events', 'claims', 'knowledge', 'disclosures', 'threads'] as const) {
    const semantic = (item: unknown) => JSON.stringify(item, (key, content: unknown) => ['confirmed', 'stale'].includes(key) || (key === 'status' && ['fresh', 'pending', 'stale'].includes(String(content))) ? undefined : content);
    for (const item of value[collection]) {
      const existing = merged[collection].find(record => record.id === item.id);
      if (existing && semantic(existing) !== semantic(item)) throw new Error('记忆重复身份指向不同内容。');
      if (!existing) (merged[collection] as unknown[]).push(item);
    }
  }
  StoryStateSchema.parse(merged);
  return value;
}
