import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { StoryStateSchema, eventRelation } from '../src/domain/story-memory.js';
import { claimVisibility, dueThreads, singleValueStoryConflicts } from '../src/context/story-rules.js';

const fixture = () => StoryStateSchema.parse(JSON.parse(readFileSync('fixtures/story-memory/harbor.json', 'utf8')));
describe('story memory contracts and visibility', () => {
  it('C01 keeps truth, reader disclosure and a character belief distinct', () => {
    const state = fixture(); const scene = state.scenes[1]!;
    expect(claimVisibility(state, state.claims[0]!, scene, 'writer').reason).toBe('knowledge-unknown-or-not-yet');
    expect(claimVisibility(state, state.claims[1]!, scene, 'writer')).toEqual({ allowed: true, reason: 'viewpoint-evidence', stance: 'believes' });
    expect(claimVisibility(state, state.claims[0]!, scene, 'reviewer').allowed).toBe(true);
    expect(state.claims[1]!.kind).toBe('belief');
  });
  it('C02 orders events independently from chapter or scene position', () => {
    const state = fixture(); const scene = { ...state.scenes[1]!, eventId: 'crime' };
    expect(eventRelation(state, 'crime', 'visit')).toBe('before');
    expect(claimVisibility(state, state.claims[1]!, scene, 'writer').reason).toBe('outside-story-time-or-unknown');
    expect(eventRelation(state, null, 'crime')).toBe('unknown');
  });
  it('C03 never infers knowledge from co-occurrence, unknown time or a future plan', () => {
    const state = fixture(); state.knowledge[0]!.learnedAt = null;
    expect(claimVisibility(state, state.claims[1]!, state.scenes[1]!, 'writer').allowed).toBe(false);
    state.knowledge[0]!.learnedAt = 'learn';
    expect(claimVisibility(state, state.claims[1]!, state.scenes[2]!, 'writer').allowed).toBe(false);
  });
  it('C05 allows distinct identities with the same display name but rejects ambiguous aliases', () => {
    const state = fixture(); state.entities[1]!.name = state.entities[0]!.name;
    expect(StoryStateSchema.safeParse(state).success).toBe(true);
    state.entities[1]!.aliases = ['小林']; expect(StoryStateSchema.safeParse(state).success).toBe(false);
  });
  it.each(['speech', 'rumor', 'dream'] as const)('C06 keeps attributed %s out of world knowledge', kind => {
    const state = fixture(); state.claims[1]!.kind = kind;
    expect(StoryStateSchema.parse(state).claims[1]!.kind).toBe(kind);
    state.knowledge[0]!.stance = 'knows'; expect(StoryStateSchema.safeParse(state).success).toBe(false);
    state.claims[1]!.holderId = null; expect(StoryStateSchema.safeParse(state).success).toBe(false);
  });
  it('C07 always selects due unresolved threads independently from query terms', () => {
    const state = fixture(); expect(dueThreads(state, 'investigation').map(item => item.id)).toEqual(['letter']);
    state.threads[0]!.status = 'abandoned'; expect(dueThreads(state, 'investigation')).toEqual([]);
  });
  it('C08 reports only established single-value overlaps and keeps possessions multiple', () => {
    const state = fixture(); const original = { ...state.claims[0]!, relation: 'possession' as const };
    state.claims = [original, { ...original, id: 'second', value: '另一件物品' }];
    expect(singleValueStoryConflicts(state, state.scenes[1]!)).toEqual([]);
    state.claims.forEach(claim => { claim.relation = 'location'; });
    expect(singleValueStoryConflicts(state, state.scenes[1]!)).toEqual([['killer', 'second']]);
    state.claims[1]!.fromEventId = null; expect(singleValueStoryConflicts(state, state.scenes[1]!)).toEqual([]);
  });
  it('rejects dangling references, cycles, reversed intervals, bad attribution and missing viewpoints', () => {
    for (const mutate of [
      (s: ReturnType<typeof fixture>) => { s.order.push({ before: 'learn', after: 'crime' }); },
      (s: ReturnType<typeof fixture>) => { s.scenes[1]!.viewpointId = null; },
      (s: ReturnType<typeof fixture>) => { s.claims[0]!.untilEventId = 'crime'; },
      (s: ReturnType<typeof fixture>) => { s.claims[0]!.subjectId = 'unknown'; },
      (s: ReturnType<typeof fixture>) => { s.claims[0]!.source = { kind: 'plan', chapterId: 'c8', revisionId: 'future' }; },
    ]) { const state = fixture(); mutate(state); expect(StoryStateSchema.safeParse(state).success).toBe(false); }
  });
  it('C14 excludes stale, unconfirmed and not-yet-disclosed claims even for omniscient narration', () => {
    const state = fixture(); const scene = { ...state.scenes[1]!, narration: 'omniscient' as const };
    state.disclosures = []; expect(claimVisibility(state, state.claims[0]!, scene, 'writer').allowed).toBe(false);
    state.claims[1]!.status = 'stale'; expect(claimVisibility(state, state.claims[1]!, scene, 'writer').allowed).toBe(false);
    state.claims[1]!.status = 'fresh'; state.claims[1]!.confirmed = false;
    expect(claimVisibility(state, state.claims[1]!, scene, 'writer').allowed).toBe(false);
  });
  it('C10 moving a reveal after the target immediately removes reader access', () => {
    const state = fixture(); const scene = { ...state.scenes[1]!, narration: 'omniscient' as const };
    expect(claimVisibility(state, state.claims[0]!, scene, 'writer').allowed).toBe(true);
    state.disclosures[0]!.sceneId = 'truth';
    expect(claimVisibility(state, state.claims[0]!, scene, 'writer').reason).toBe('not-disclosed');
  });
  it('C09 candidates cannot enter the shared formal view', () => {
    const state = fixture(); state.claims[1]!.status = 'pending';
    expect(claimVisibility(state, state.claims[1]!, state.scenes[1]!, 'writer').allowed).toBe(false);
  });
  it('rejects duplicate identities and half-specified source ranges', () => {
    const state = fixture(); state.entities.push(state.entities[0]!);
    expect(StoryStateSchema.safeParse(state).success).toBe(false); state.entities.pop();
    state.claims[0]!.source = { kind: 'text', chapterId: 'c', revisionId: 'r', blockId: 'b', quote: '原句', contentHash: 'hash', start: 2 };
    expect(StoryStateSchema.safeParse(state).success).toBe(false);
  });
  it('does not treat a planned reveal as an actual disclosure in following scenes', () => {
    const state = fixture(); state.disclosures[0]!.status = 'planned';
    expect(claimVisibility(state, state.claims[0]!, { ...state.scenes[1]!, narration: 'omniscient' }, 'writer').allowed).toBe(false);
    expect(claimVisibility(state, state.claims[0]!, state.scenes[0]!, 'writer').allowed).toBe(true);
  });
});
