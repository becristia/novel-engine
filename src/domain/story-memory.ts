import { z } from 'zod';

export const StoryId = z.string().trim().min(1).max(200);
export const StorySourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), chapterId: StoryId, revisionId: StoryId, blockId: StoryId, quote: z.string().min(1), contentHash: z.string().min(1), start: z.number().int().nonnegative().optional(), end: z.number().int().positive().optional() }),
  z.strictObject({ kind: z.literal('author'), decisionId: StoryId }),
  z.strictObject({ kind: z.literal('plan'), chapterId: StoryId, revisionId: StoryId }),
]);
export type StorySource = z.infer<typeof StorySourceSchema>;
export const StoryEntitySchema = z.strictObject({ id: StoryId, name: z.string().trim().min(1), aliases: z.array(z.string().trim().min(1)) });
export const StoryEventSchema = z.strictObject({ id: StoryId, title: z.string().trim().min(1), occurrence: z.enum(['actual', 'planned', 'unknown']), source: StorySourceSchema, stale: z.boolean().optional() });
export const StorySceneSchema = z.strictObject({
  id: StoryId, chapterId: StoryId, title: z.string().trim().min(1), eventId: StoryId.nullable(),
  viewpointId: StoryId.nullable(), narration: z.enum(['limited', 'omniscient', 'unreliable', 'unspecified']),
  goal: z.string(), instructions: z.array(z.string().min(1)), revisionId: StoryId.nullable(),
  start: z.number().int().nonnegative().optional(), end: z.number().int().positive().optional(),
});
export const StoryClaimSchema = z.strictObject({
  id: StoryId, subjectId: StoryId, relation: z.enum(['location', 'possession', 'identity', 'knowledge', 'event', 'foreshadow', 'condition']), value: z.string().trim().min(1),
  kind: z.enum(['fact', 'belief', 'plan', 'speech', 'rumor', 'dream', 'inference']), holderId: StoryId.nullable(),
  fromEventId: StoryId.nullable(), untilEventId: StoryId.nullable(),
  visibility: z.enum(['public', 'restricted']), confirmed: z.boolean(), status: z.enum(['pending', 'fresh', 'stale']),
  source: StorySourceSchema, dependsOn: z.array(StoryId), correctsId: StoryId.nullable(),
});
export const StoryKnowledgeSchema = z.strictObject({
  id: StoryId, characterId: StoryId, claimId: StoryId, stance: z.enum(['knows', 'believes', 'suspects', 'heard']),
  learnedAt: StoryId.nullable(), untilEventId: StoryId.nullable(), source: StorySourceSchema, status: z.enum(['fresh', 'stale']),
});
export const StoryDisclosureSchema = z.strictObject({ id: StoryId, claimId: StoryId, sceneId: StoryId, level: z.enum(['hint', 'reveal']), status: z.enum(['planned', 'actual']), source: StorySourceSchema, stale: z.boolean().optional() });
export const StoryThreadSchema = z.strictObject({ id: StoryId, title: z.string().min(1), instruction: z.string().min(1), status: z.enum(['planned', 'planted', 'resolved', 'abandoned']), dueSceneId: StoryId.nullable(), claimIds: z.array(StoryId), source: StorySourceSchema, stale: z.boolean().optional() });
export const StoryRuleSchema = z.strictObject({ id: StoryId, text: z.string().min(1), kind: z.enum(['constraint', 'style']), visibility: z.enum(['writer', 'staff']), source: StorySourceSchema, stale: z.boolean().optional() });

export const StoryShape = z.strictObject({
  schemaVersion: z.literal(1), entities: z.array(StoryEntitySchema), events: z.array(StoryEventSchema),
  order: z.array(z.strictObject({ before: StoryId, after: StoryId })), scenes: z.array(StorySceneSchema), claims: z.array(StoryClaimSchema),
  knowledge: z.array(StoryKnowledgeSchema), disclosures: z.array(StoryDisclosureSchema), threads: z.array(StoryThreadSchema), rules: z.array(StoryRuleSchema),
});
export type StoryState = z.infer<typeof StoryShape>;
export type StoryScene = z.infer<typeof StorySceneSchema>;
export type StoryClaim = z.infer<typeof StoryClaimSchema>;
export const StoryTaskSchema = z.enum(['planner', 'writer', 'reviewer', 'extractor', 'impact']);
export type StoryTask = z.infer<typeof StoryTaskSchema>;

export function eventRelation(state: Pick<StoryState, 'order'>, left: string | null, right: string | null): 'before' | 'equal' | 'after' | 'unknown' {
  if (left === null || right === null) return 'unknown';
  if (left === right) return 'equal';
  const reaches = (from: string, to: string) => {
    const pending = [from]; const visited = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const edge of state.order.filter(item => item.before === current)) { if (edge.after === to) return true; pending.push(edge.after); }
    }
    return false;
  };
  if (reaches(left, right)) return 'before';
  if (reaches(right, left)) return 'after';
  return 'unknown';
}

export const StoryStateSchema = StoryShape.superRefine((state, context) => {
  const fail = (path: (string | number)[], message: string) => context.addIssue({ code: 'custom', path, message });
  const groups = ['entities', 'events', 'scenes', 'claims', 'knowledge', 'disclosures', 'threads', 'rules'] as const;
  for (const group of groups) if (new Set(state[group].map(item => item.id)).size !== state[group].length) fail([group], '身份重复。');
  const entities = new Set(state.entities.map(item => item.id)); const events = new Set(state.events.map(item => item.id));
  const scenes = new Set(state.scenes.map(item => item.id)); const claims = new Map(state.claims.map(item => [item.id, item]));
  const check = (values: Set<string>, value: string | null, path: (string | number)[]) => { if (value !== null && !values.has(value)) fail(path, '引用身份不存在。'); };
  const aliases = new Map<string, string>();
  state.entities.forEach((entity, index) => {
    for (const alias of entity.aliases) {
      if ((aliases.has(alias) && aliases.get(alias) !== entity.id) || state.entities.some(other => other.id !== entity.id && other.name === alias)) fail(['entities', index, 'aliases'], '别名指向多个角色。');
      aliases.set(alias, entity.id);
    }
  });
  const intervals = (from: string | null, until: string | null, path: (string | number)[]) => {
    check(events, from, [...path, 'from']); check(events, until, [...path, 'until']);
    if (from !== null && until !== null && ['equal', 'after'].includes(eventRelation(state, from, until))) fail(path, '有效区间结束不得早于或等于开始。');
  };
  state.events.forEach((event, index) => { if (event.source.kind === 'plan' && event.occurrence === 'actual') fail(['events', index], '计划来源不能证明事件已经发生。'); });
  if (new Set(state.order.map(edge => `${edge.before}\u0000${edge.after}`)).size !== state.order.length) fail(['order'], '事件关系重复。');
  state.order.forEach((edge, index) => {
    check(events, edge.before, ['order', index]); check(events, edge.after, ['order', index]);
    if (edge.before === edge.after || eventRelation({ order: state.order.filter((_, i) => i !== index) }, edge.after, edge.before) === 'before') fail(['order', index], '事件先后关系存在循环。');
  });
  state.scenes.forEach((scene, index) => {
    check(events, scene.eventId, ['scenes', index, 'eventId']); check(entities, scene.viewpointId, ['scenes', index, 'viewpointId']);
    if (['limited', 'unreliable'].includes(scene.narration) && scene.viewpointId === null) fail(['scenes', index, 'viewpointId'], '有限或不可靠视角必须指定人物。');
    if ((scene.start === undefined) !== (scene.end === undefined) || (scene.start !== undefined && (scene.end! <= scene.start || scene.revisionId === null))) fail(['scenes', index], '场景范围必须绑定正文版本并成对指定。');
  });
  state.claims.forEach((claim, index) => {
    check(entities, claim.subjectId, ['claims', index, 'subjectId']); check(entities, claim.holderId, ['claims', index, 'holderId']);
    intervals(claim.fromEventId, claim.untilEventId, ['claims', index]);
    if (['belief', 'speech', 'rumor', 'dream'].includes(claim.kind) && claim.holderId === null) fail(['claims', index, 'holderId'], '归属信息必须指定持有人。');
    if (claim.source.kind === 'plan' && claim.kind !== 'plan') fail(['claims', index, 'source'], '计划来源不能作为已发生事实。');
    if (claim.correctsId === claim.id) fail(['claims', index, 'correctsId'], '纠正不能引用自身。');
    check(new Set(claims.keys()), claim.correctsId, ['claims', index, 'correctsId']);
    const dependencies = new Set(['order', 'constraints', ...groups.flatMap(group => state[group].map(item => `${group}:${item.id}`))]);
    claim.dependsOn.forEach(id => { if (!dependencies.has(id)) fail(['claims', index, 'dependsOn'], '依赖身份不存在。'); });
  });
  for (const claim of state.claims) {
    const corrections = new Set([claim.id]); let parent = claim.correctsId;
    while (parent !== null) { if (corrections.has(parent)) { fail(['claims'], '纠正链存在循环。'); break; } corrections.add(parent); parent = claims.get(parent)?.correctsId ?? null; }
    const visited = new Set<string>();
    const visit = (id: string): boolean => {
      if (id === claim.id) return true;
      if (visited.has(id)) return false;
      visited.add(id);
      return (claims.get(id)?.dependsOn ?? []).filter(key => key.startsWith('claims:')).some(key => visit(key.slice(7)));
    };
    if (claim.dependsOn.filter(key => key.startsWith('claims:')).some(key => visit(key.slice(7)))) fail(['claims'], '断言依赖存在循环。');
  }
  state.knowledge.forEach((item, index) => {
    check(entities, item.characterId, ['knowledge', index, 'characterId']); check(new Set(claims.keys()), item.claimId, ['knowledge', index, 'claimId']);
    intervals(item.learnedAt, item.untilEventId, ['knowledge', index]);
    if (item.status === 'fresh' && item.stance === 'knows' && claims.get(item.claimId)?.kind !== 'fact') fail(['knowledge', index, 'stance'], '只有世界事实可以标记为知道。');
    if (item.source.kind === 'plan' && item.status === 'fresh') fail(['knowledge', index, 'source'], '未来获知计划不能作为实际知情。');
  });
  state.disclosures.forEach((item, index) => {
    check(new Set(claims.keys()), item.claimId, ['disclosures', index, 'claimId']); check(scenes, item.sceneId, ['disclosures', index, 'sceneId']);
    if (item.status === 'actual' && item.source.kind === 'plan') fail(['disclosures', index], '披露计划不能作为已经披露。');
  });
  state.threads.forEach((item, index) => {
    check(scenes, item.dueSceneId, ['threads', index, 'dueSceneId']);
    item.claimIds.forEach(id => check(new Set(claims.keys()), id, ['threads', index, 'claimIds']));
    if (['planted', 'resolved'].includes(item.status) && item.source.kind !== 'text') fail(['threads', index, 'source'], '实际埋设和回收需要正文来源。');
  });
  for (const group of ['events', 'claims', 'knowledge', 'disclosures', 'threads', 'rules'] as const) state[group].forEach((item, index) => {
    const source = item.source;
    if (source.kind === 'text' && ((source.start === undefined) !== (source.end === undefined) || (source.start !== undefined && source.end! <= source.start))) fail([group, index, 'source'], '原文范围必须成对且结束大于开始。');
  });
});

export function emptyStory(): StoryState { return { schemaVersion: 1, entities: [], events: [], order: [], scenes: [], claims: [], knowledge: [], disclosures: [], threads: [], rules: [] }; }

export const storyCollections = ['entities', 'events', 'scenes', 'claims', 'knowledge', 'disclosures', 'threads', 'rules'] as const;
export type StoryCollection = typeof storyCollections[number];
