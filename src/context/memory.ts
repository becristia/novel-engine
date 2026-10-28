import { FactSchema } from '../domain/review.js';
import type { ApprovedPlan } from '../domain/planning.js';
import type { BookState } from '../domain/workspace.js';
import { MemoryStore } from '../storage/memory-store.js';

export const relationCardinality = { location: 'single', identity: 'single', possession: 'multiple', knowledge: 'multiple', event: 'multiple', foreshadow: 'multiple' } as const;

export function relevantFacts(memory: MemoryStore, state: BookState, plan: ApprovedPlan, allowedRevisions: ReadonlySet<string>) {
  const names = new Set(plan.characters.flatMap(character => [character, ...(state.aliases[character] ?? [])]));
  const canonical = (name: string) => Object.entries(state.aliases).find(([id, aliases]) => id === name || aliases.includes(name))?.[0] ?? name;
  return memory.entries().filter(entry => entry.kind === 'fact' && entry.status === 'fresh' && entry.confirmed === 1 && state.confirmedFactIds.includes(entry.id) && allowedRevisions.has(entry.revisionId)).map(entry => ({ entry, fact: FactSchema.parse(JSON.parse(entry.payload)) })).filter(({ fact }) => {
    return names.has(fact.subject) || plan.characters.some(character => canonical(character) === canonical(fact.subject)) || ['event', 'foreshadow'].includes(fact.relation);
  });
}

export function memoryGroups(items: ReturnType<typeof relevantFacts>, plan: ApprovedPlan, aliases: BookState['aliases']) {
  const canonical = (name: string | null | undefined) => name == null ? null : Object.entries(aliases).find(([id, names]) => id === name || names.includes(name))?.[0] ?? name;
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    if (item.fact.kind !== 'fact' || relationCardinality[item.fact.relation] !== 'single' || item.fact.storyTime === null) continue;
    const key = JSON.stringify([item.fact.subject, item.fact.relation, item.fact.storyTime]);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return {
    facts: items.filter(item => item.fact.kind === 'fact').map(item => item.entry.id),
    beliefs: items.filter(item => item.fact.kind === 'belief').map(item => item.entry.id),
    futurePlans: items.filter(item => item.fact.kind === 'plan').map(item => item.entry.id),
    knownByViewpoint: items.filter(item => item.fact.kind === 'fact' && item.fact.relation === 'knowledge' && plan.viewpointCharacter != null && canonical(item.fact.characterId) === canonical(plan.viewpointCharacter) && item.fact.knowledgeTime !== null).map(item => item.entry.id),
    knowledgeBoundary: plan.viewpointCharacter == null ? 'unknown-viewpoint' : 'explicit-evidence-only',
    singleValueConflicts: [...groups.values()].filter(group => new Set(group.map(item => item.fact.value)).size > 1).map(group => group.map(item => item.entry.id)),
    timePolicy: 'Story time is explicit data; chapter order only limits narrative disclosure.',
  };
}
