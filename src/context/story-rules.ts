import { eventRelation } from '../domain/story-memory.js';
import type { StoryClaim, StoryScene, StoryState, StoryTask } from '../domain/story-memory.js';

export function withinStoryInterval(state: StoryState, target: string | null, from: string | null, until: string | null): boolean {
  if (from !== null && !['before', 'equal'].includes(eventRelation(state, from, target))) return false;
  if (until !== null && eventRelation(state, target, until) !== 'before') return false;
  return true;
}

export function claimVisibility(state: StoryState, claim: StoryClaim, scene: StoryScene, task: StoryTask): { allowed: boolean; reason: string; stance?: string } {
  const no = (reason: string) => ({ allowed: false, reason });
  if (claim.status !== 'fresh') return no('source-not-fresh');
  if (!claim.confirmed) return no('unconfirmed');
  if (task === 'extractor') return no('extractor-target-only');
  if (task !== 'writer') return { allowed: true, reason: 'staff-review' };
  if (scene.narration === 'unspecified') return no('narration-unspecified');
  if (claim.kind === 'plan' || claim.kind === 'inference') return no('not-established');
  if (!withinStoryInterval(state, scene.eventId, claim.fromEventId, claim.untilEventId)) return no('outside-story-time-or-unknown');
  if (claim.fromEventId && !state.events.some(event => event.id === claim.fromEventId && event.occurrence === 'actual' && !event.stale)) return no('event-not-established');
  const position = state.scenes.findIndex(item => item.id === scene.id);
  const disclosed = claim.visibility === 'public' || state.disclosures.some(item => !item.stale && item.claimId === claim.id && item.level === 'reveal' && (
    item.status === 'actual' ? state.scenes.findIndex(candidate => candidate.id === item.sceneId) <= position : item.sceneId === scene.id
  ));
  if (!disclosed) return no('not-disclosed');
  if (scene.narration === 'omniscient') return { allowed: true, reason: 'allowed-narration', stance: claim.kind };
  if (claim.holderId !== null && claim.holderId !== scene.viewpointId) return no('other-character-belief');
  const knowledge = state.knowledge.find(item => item.claimId === claim.id && item.characterId === scene.viewpointId && item.status === 'fresh'
    && item.learnedAt !== null && state.events.some(event => event.id === item.learnedAt && event.occurrence === 'actual' && !event.stale)
    && withinStoryInterval(state, scene.eventId, item.learnedAt, item.untilEventId));
  if (!knowledge) {
    if (claim.kind === 'fact' && state.disclosures.some(item => !item.stale && item.claimId === claim.id && item.sceneId === scene.id && item.level === 'reveal' && item.status === 'planned')) return { allowed: true, reason: 'learn-in-this-scene', stance: '本场景计划获知；不能写成此前已知' };
    return no('knowledge-unknown-or-not-yet');
  }
  return { allowed: true, reason: 'viewpoint-evidence', stance: knowledge.stance };
}

export function dueThreads(state: StoryState, sceneId: string) {
  return state.threads.filter(item => !item.stale && item.dueSceneId === sceneId && !['resolved', 'abandoned'].includes(item.status));
}

export function singleValueStoryConflicts(state: StoryState, scene: StoryScene) {
  const groups = new Map<string, StoryClaim[]>();
  for (const claim of state.claims) {
    if (claim.kind !== 'fact' || !claim.confirmed || claim.status !== 'fresh' || !['location', 'identity', 'condition'].includes(claim.relation) || claim.fromEventId === null) continue;
    if (!withinStoryInterval(state, scene.eventId, claim.fromEventId, claim.untilEventId)) continue;
    const key = `${claim.subjectId}:${claim.relation}`; groups.set(key, [...(groups.get(key) ?? []), claim]);
  }
  return [...groups.values()].filter(items => new Set(items.map(item => item.value)).size > 1).map(items => items.map(item => item.id));
}
