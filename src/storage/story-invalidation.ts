import type { BookState } from '../domain/workspace.js';
import type { StorySource, StoryState } from '../domain/story-memory.js';

export function isCurrentSource(source: StorySource, state: BookState): boolean {
  if (source.kind === 'author') return true;
  if (source.kind === 'plan') return state.plans[source.chapterId]?.revisionId === source.revisionId;
  return state.chapters.some(chapter => chapter.id === source.chapterId && chapter.revisionId === source.revisionId);
}

const collections = ['entities', 'events', 'scenes', 'claims', 'knowledge', 'disclosures', 'threads', 'rules'] as const;
const semantic = (item: unknown) => JSON.stringify(item, (key, value: unknown) => key === 'confirmed' || key === 'stale' || (key === 'status' && ['fresh', 'pending', 'stale'].includes(String(value))) ? undefined : value);

export function invalidateStory(before: BookState, after: BookState): string[] {
  const story = after.story; if (!story) return [];
  const original = before.story;
  const changed = new Set<string>();
  if (original) for (const collection of collections) for (const item of original[collection]) {
    if (semantic(item) !== semantic(story[collection].find(next => next.id === item.id))) changed.add(`${collection}:${item.id}`);
  }
  const orderChanged = Boolean(original && JSON.stringify(original.order) !== JSON.stringify(story.order));
  if (orderChanged) changed.add('order');
  if (JSON.stringify(before.constraints) !== JSON.stringify(after.constraints)) changed.add('constraints');
  const chapterOrderChanged = before.chapters.map(item => item.id).filter(id => after.chapters.some(item => item.id === id)).join() !== after.chapters.map(item => item.id).filter(id => before.chapters.some(item => item.id === id)).join();
  const invalid = new Set<string>();
  const unchanged = (collection: keyof StoryState, id: string, value: unknown) => original && semantic((original[collection] as { id: string }[]).find(item => item.id === id)) === semantic(value);
  for (const event of story.events) if (!isCurrentSource(event.source, after)) { event.stale = true; invalid.add(`events:${event.id}`); }
  let progress = true;
  while (progress) {
    progress = false;
    for (const claim of story.claims) {
      const dependencies = [...claim.dependsOn, ...[claim.fromEventId, claim.untilEventId].filter(id => id !== null).map(id => `events:${id}`)];
      const incomplete = claim.source.kind === 'text' && claim.dependsOn.length === 0 && (orderChanged || changed.has('constraints'));
      if (claim.status === 'stale' || !isCurrentSource(claim.source, after) || (unchanged('claims', claim.id, claim) && (incomplete || dependencies.some(key => changed.has(key) || invalid.has(key))))) {
        claim.status = 'stale'; const key = `claims:${claim.id}`;
        if (!invalid.has(key)) { invalid.add(key); progress = true; }
      }
    }
  }
  for (const knowledge of story.knowledge) {
    const affected = [`claims:${knowledge.claimId}`, ...[knowledge.learnedAt, knowledge.untilEventId].filter(id => id !== null).map(id => `events:${id}`)];
    if (!isCurrentSource(knowledge.source, after) || affected.some(key => invalid.has(key)) || (unchanged('knowledge', knowledge.id, knowledge) && affected.some(key => changed.has(key)))) {
      knowledge.status = 'stale'; invalid.add(`knowledge:${knowledge.id}`);
    }
  }
  for (const disclosure of story.disclosures) {
    const scene = story.scenes.find(item => item.id === disclosure.sceneId);
    const sourceValid = scene?.revisionId === null || after.chapters.some(item => item.id === scene?.chapterId && item.revisionId === scene.revisionId);
    if (!isCurrentSource(disclosure.source, after) || invalid.has(`claims:${disclosure.claimId}`) || (disclosure.status === 'actual' && !sourceValid) || (unchanged('disclosures', disclosure.id, disclosure) && (changed.has(`claims:${disclosure.claimId}`) || changed.has(`scenes:${disclosure.sceneId}`)))) {
      disclosure.stale = true; invalid.add(`disclosures:${disclosure.id}`);
    }
  }
  for (const item of [...story.threads, ...story.rules]) if (!isCurrentSource(item.source, after)) item.stale = true;
  // Scene order is re-evaluated in every context; it does not rewrite story time.
  if (chapterOrderChanged) changed.add('narrative-order');
  return [...new Set([...changed, ...invalid])];
}
