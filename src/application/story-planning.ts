import { randomUUID } from 'node:crypto';
import type { ApprovedPlan } from '../domain/planning.js';
import type { BookState } from '../domain/workspace.js';
import { StoryStateSchema } from '../domain/story-memory.js';
import { legacyStory } from '../storage/story-store.js';

export function applyScenePlans(state: BookState, plan: ApprovedPlan): void {
  if (!plan.scenes) return;
  const story = state.story ?? legacyStory(state);
  for (const name of plan.characters) {
    const matches = story.entities.filter(entity => entity.id === name || entity.name === name || entity.aliases.includes(name));
    if (matches.length > 1) throw new Error('人物身份有同名歧义，请先明确稳定身份。');
    if (!matches.length) story.entities.push({ id: randomUUID(), name, aliases: [] });
  }
  for (const scene of plan.scenes) {
    if (story.scenes.some(item => item.id === scene.id && item.chapterId !== plan.chapterId)) throw new Error('场景身份已经属于其他章节。');
    const character = story.entities.filter(entity => entity.id === scene.viewpointCharacter || entity.name === scene.viewpointCharacter || entity.aliases.includes(scene.viewpointCharacter ?? ''));
    if (scene.viewpointCharacter !== null && character.length !== 1) throw new Error('场景视角人物不存在或有同名歧义。');
    const value = { id: scene.id, chapterId: plan.chapterId, title: scene.title, goal: scene.goal, instructions: scene.instructions, eventId: scene.eventId, viewpointId: character[0]?.id ?? null, narration: scene.narration, revisionId: null };
    const index = story.scenes.findIndex(item => item.id === scene.id);
    if (index < 0) story.scenes.push(value); else story.scenes[index] = value;
    for (const claimId of scene.revealClaimIds) story.disclosures.push({ id: randomUUID(), claimId, sceneId: scene.id, level: 'reveal', status: 'planned', source: { kind: 'plan', chapterId: plan.chapterId, revisionId: plan.revisionId } });
    for (const threadId of scene.threadIds) {
      const thread = story.threads.find(item => item.id === threadId);
      if (!thread) throw new Error('场景引用的伏笔不存在。');
      thread.dueSceneId = scene.id;
    }
  }
  // The legacy placeholder has no story annotations. Explicit scenes replace it.
  story.scenes = story.scenes.filter(scene => scene.chapterId !== plan.chapterId || scene.id !== `scene-${plan.chapterId}` || plan.scenes!.some(item => item.id === scene.id));
  state.story = StoryStateSchema.parse(story);
}
