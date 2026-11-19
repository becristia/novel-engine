import type { AppConfig } from '../domain/model-config.js';
import type { StoryClaim, StoryScene, StoryState, StoryTask, StorySource } from '../domain/story-memory.js';
import type { BookState } from '../domain/workspace.js';
import { BookStore } from '../storage/book-store.js';
import { StoryStore, sourceCurrent } from '../storage/story-store.js';
import { resolveReference } from '../review/evidence.js';
import { claimVisibility, dueThreads, singleValueStoryConflicts } from './story-rules.js';
import type { ContextSnapshot } from './builder.js';

// Projection is local and read-only. Stale annotations must never authorize access.
export function activeStory(book: BookStore, version: number): StoryState {
  const snapshot = book.snapshot(version).state; const story = new StoryStore(book).view(version).story;
  const orderedChapters = [...snapshot.chapters.map(item => item.id), ...Object.values(snapshot.plans).sort((a, b) => a.ordinal - b.ordinal).map(item => item.chapterId).filter(id => !snapshot.chapters.some(item => item.id === id))];
  story.scenes.sort((a, b) => orderedChapters.indexOf(a.chapterId) - orderedChapters.indexOf(b.chapterId));
  for (const event of story.events) if (event.stale || !sourceCurrent(event.source, snapshot)) event.occurrence = 'unknown';
  story.order = story.order.filter(edge => [edge.before, edge.after].every(id => story.events.some(event => event.id === id && !event.stale && sourceCurrent(event.source, snapshot))));
  story.disclosures = story.disclosures.filter(item => !item.stale && sourceCurrent(item.source, snapshot) && (item.status === 'planned' || currentScene(story.scenes.find(scene => scene.id === item.sceneId)!, snapshot)));
  story.threads = story.threads.filter(item => !item.stale && sourceCurrent(item.source, snapshot));
  story.rules = story.rules.filter(item => !item.stale && sourceCurrent(item.source, snapshot));
  return story;
}

function currentScene(scene: StoryScene, state: BookState): boolean {
  return scene.revisionId === null || state.chapters.some(chapter => chapter.id === scene.chapterId && chapter.revisionId === scene.revisionId);
}

// This guards known literal leaks; semantic leakage is checked separately by review.
export function writerTextAllowed(text: string, forbidden: readonly (StoryClaim & { subjectNames: string[] })[]): boolean {
  return forbidden.every(claim => !(text.includes(claim.value) && claim.subjectNames.some(name => text.includes(name))) && (claim.source.kind !== 'text' || !text.includes(claim.source.quote)));
}

export function writerForbidden(story: StoryState, scene: StoryScene) {
  return story.claims.filter(claim => !claimVisibility(story, claim, scene, 'writer').allowed).map(claim => {
    const entity = story.entities.find(item => item.id === claim.subjectId)!;
    return { ...claim, subjectNames: [entity.name, ...entity.aliases] };
  });
}

export function storySource(kind: ContextSnapshot['sources'][number]['kind'], id: string, revisionId: string, text: string, reason: string, reference?: StorySource): ContextSnapshot['sources'][number] {
  return { kind, id, revisionId, text, reason, estimatedTokens: Buffer.byteLength(text, 'utf8'), ...(reference ? { reference } : {}) };
}

export function buildSceneContext(book: BookStore, sceneId: string, config: AppConfig, version = book.project().version, task: StoryTask = 'writer'): ContextSnapshot & { memory: NonNullable<ContextSnapshot['memory']> } {
  const snapshot = book.snapshot(version).state; const story = activeStory(book, version);
  const scene = story.scenes.find(item => item.id === sceneId);
  if (!scene) throw new Error('场景不存在。');
  const chapterPlan = snapshot.plans[scene.chapterId];
  if (task === 'writer' && scene.narration === 'unspecified') throw new Error('场景叙述方式未确定，请先设置视角。');
  if (task === 'writer' && !chapterPlan) throw new Error('本章没有已批准计划。');
  const omissions: NonNullable<ContextSnapshot['omissions']> = [];
  const sources: ContextSnapshot['sources'] = [];
  const forbidden = writerForbidden(story, scene);
  const safe = (text: string) => task !== 'writer' || writerTextAllowed(text, forbidden);
  const required = (item: ContextSnapshot['sources'][number]) => {
    if (!safe(item.text)) throw new Error('场景指令或硬约束包含本视角不可用信息，请先改写为安全指令。');
    sources.push(item);
  };
  const plan = { chapterId: scene.chapterId, revisionId: chapterPlan?.revisionId ?? String(version), ordinal: chapterPlan?.ordinal ?? 1,
    title: safe(chapterPlan?.title ?? scene.title) ? (chapterPlan?.title ?? scene.title) : '章节', goal: scene.goal,
    characters: scene.viewpointId ? [story.entities.find(item => item.id === scene.viewpointId)!.name] : [], constraints: [] as string[], events: [] as string[], targetLength: chapterPlan ? Math.ceil(chapterPlan.targetLength / Math.max(1, story.scenes.filter(item => item.chapterId === scene.chapterId).length)) : 2000 };
  if (task === 'extractor') {
    plan.goal = ''; plan.title = '正文抽取'; plan.characters = [];
    sources.push(storySource('story-state', 'identities', String(version), JSON.stringify(story.entities), '身份字典；没有全局设定或计划'));
  } else if (task !== 'writer') {
    sources.push(storySource('story-state', 'story', String(version), JSON.stringify(story), '全局审查视图；不能转交 Writer'));
    sources.push(storySource('constraint', 'author', String(version), JSON.stringify(snapshot.constraints), '作者约束'));
    for (const chapter of snapshot.chapters) sources.push(storySource('chapter', chapter.id, chapter.revisionId, book.revision(chapter.revisionId).content, '当前正式原文'));
  } else {
    required(storySource('constraint', 'author', String(version), JSON.stringify([...snapshot.constraints, ...chapterPlan!.constraints]), '作者和本章硬约束，已核对已知禁用内容'));
    required(storySource('story-scene', scene.id, chapterPlan!.revisionId, JSON.stringify({ id: scene.id, goal: scene.goal, instructions: scene.instructions, narration: scene.narration, viewpointId: scene.viewpointId, eventId: scene.eventId }), '已批准场景指令；不是已发生事实'));
    for (const rule of story.rules) {
      if (rule.visibility !== 'writer') { omissions.push({ id: rule.id, reason: 'staff-only' }); continue; }
      required(storySource('story-rule', rule.id, String(version), rule.text, '作者明确允许 Writer 使用的规则', rule.source.kind === 'text' ? undefined : rule.source));
    }
    for (const thread of dueThreads(story, scene.id)) required(storySource('story-thread', thread.id, String(version), thread.instruction, '到期伏笔必选；仅包含安全执行指令', thread.source.kind === 'text' ? undefined : thread.source));
    const due = new Set(dueThreads(story, scene.id).flatMap(item => item.claimIds));
    const mandatory = (claim: StoryClaim) => due.has(claim.id) || (claim.subjectId === scene.viewpointId && ['identity', 'location', 'condition'].includes(claim.relation));
    const relevant = (claim: StoryClaim) => {
      const entity = story.entities.find(item => item.id === claim.subjectId)!;
      return mandatory(claim) || claim.holderId === scene.viewpointId || claim.subjectId === scene.viewpointId || chapterPlan!.characters.some(name => [entity.id, entity.name, ...entity.aliases].includes(name)) || [entity.name, ...entity.aliases].some(name => `${scene.goal} ${scene.instructions.join(' ')}`.includes(name)) || story.disclosures.some(item => item.claimId === claim.id && item.sceneId === scene.id);
    };
    const optional = (item: ContextSnapshot['sources'][number], requiredItem: boolean) => {
      // Leave room for the plan and protocol metadata. Omission diagnostics are
      // persisted but not sent to Writer as story content.
      const size = Buffer.byteLength(JSON.stringify({ plan, sources: [...sources, item] })) + 2048;
      if (size > config.model.contextWindowTokens - config.model.maxOutputTokens - 2048) {
        if (requiredItem) throw new Error('上下文必要人物状态超出预算。');
        omissions.push({ id: item.id, reason: 'budget' }); return false;
      }
      sources.push(item); return true;
    };
    for (const claim of [...story.claims].sort((left, right) => Number(mandatory(right)) - Number(mandatory(left)))) {
      const decision = claimVisibility(story, claim, scene, task);
      if (!decision.allowed) { omissions.push({ id: claim.id, reason: decision.reason }); continue; }
      if (!relevant(claim)) { omissions.push({ id: claim.id, reason: 'no-character-or-alias-match' }); continue; }
      const text = JSON.stringify({ id: claim.id, subject: story.entities.find(item => item.id === claim.subjectId)!.name, relation: claim.relation, value: claim.value, kind: claim.kind, holderId: claim.holderId, stance: decision.stance });
      if (!safe(text)) { omissions.push({ id: claim.id, reason: 'mixed-visibility' }); continue; }
      if (!optional(storySource('story-claim', claim.id, String(version), text, decision.reason), mandatory(claim))) continue;
      if (claim.source.kind === 'text') {
        const reference = resolveReference(book, claim.source, new Set(snapshot.chapters.map(chapter => chapter.revisionId)));
        const overlapsDenied = forbidden.some(other => other.source.kind === 'text' && other.source.revisionId === reference.revisionId && (() => {
          const denied = resolveReference(book, other.source, new Set([other.source.revisionId]));
          return denied.start! < reference.end! && reference.start! < denied.end!;
        })());
        if (!overlapsDenied && safe(reference.quote)) optional(storySource('text-range', claim.id, reference.revisionId, reference.quote, '允许命题的已定位原文片段', { ...reference, kind: 'text', contentHash: reference.contentHash! }), false);
        else omissions.push({ id: `evidence:${claim.id}`, reason: 'mixed-visibility' });
      }
    }
    for (const chapter of snapshot.chapters) omissions.push({ id: chapter.id, reason: 'whole-chapter-and-summary-unscoped' });
  }
  const result: ContextSnapshot & { memory: NonNullable<ContextSnapshot['memory']> } = { protocolVersion: 'story-v1', ruleVersion: 'story-rules-v1', task, sceneId, projectVersion: version, plan, sources, omissions, estimatedTokens: 0,
    memory: { facts: sources.filter(item => item.kind === 'story-claim' && story.claims.find(claim => claim.id === item.id)?.kind === 'fact').map(item => item.id), beliefs: sources.filter(item => item.kind === 'story-claim' && story.claims.find(claim => claim.id === item.id)?.kind !== 'fact').map(item => item.id), futurePlans: [], knownByViewpoint: sources.filter(item => item.reason === 'viewpoint-evidence').map(item => item.id), knowledgeBoundary: '仅使用明确允许的信息；未提供的知情保持未知。', singleValueConflicts: [], timePolicy: '事件时间与叙事位置独立。' } };
  if (task !== 'writer' && task !== 'extractor') result.memory = { facts: story.claims.filter(item => item.kind === 'fact').map(item => item.id), beliefs: [], futurePlans: [], knownByViewpoint: [], knowledgeBoundary: '未知知情不能判断为确定冲突。', singleValueConflicts: singleValueStoryConflicts(story, scene), timePolicy: '故事事件与章序分别判断。' };
  result.estimatedTokens = Buffer.byteLength(JSON.stringify({ ...result, omissions: undefined }), 'utf8');
  if (result.estimatedTokens > config.model.contextWindowTokens - config.model.maxOutputTokens - 2048) throw new Error('上下文超出预算，未截断硬约束或放宽来源。');
  return result;
}

export function contextRevisionIds(context: ContextSnapshot): string[] {
  return [...new Set(context.sources.flatMap(source => source.reference?.kind === 'text' ? [source.reference.revisionId] : ['chapter', 'summary', 'fact'].includes(source.kind) ? [source.revisionId] : []))];
}
