import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { emptyStory, StoryShape, StoryStateSchema, storyCollections } from '../domain/story-memory.js';
import type { StoryCollection, StorySource, StoryState } from '../domain/story-memory.js';
import { hash } from '../domain/workspace.js';
import type { BookState } from '../domain/workspace.js';
import { resolveReference } from '../review/evidence.js';
import { BookStore } from './book-store.js';
import { ReviewStore } from './review-store.js';
import { StoryChangesSchema } from '../domain/review.js';
import { validateStoryChanges } from '../review/story-extraction.js';
import { isCurrentSource } from './story-invalidation.js';

export function legacyStory(state: BookState): StoryState {
  const story = emptyStory();
  const aliasNames = new Set(Object.values(state.aliases).flat());
  const names = new Set([...Object.keys(state.aliases), ...Object.values(state.plans).flatMap(plan => plan.characters).filter(name => !aliasNames.has(name))]);
  story.entities = [...names].map(name => ({ id: `entity-${hash(name).slice(0,20)}`, name, aliases: state.aliases[name] ?? [] }));
  const chapters = [...state.chapters, ...Object.values(state.plans).filter(plan => !state.chapters.some(chapter => chapter.id === plan.chapterId)).map(plan => ({ id: plan.chapterId, title: plan.title, revisionId: null }))];
  story.scenes = chapters.map(chapter => ({ id: `scene-${chapter.id}`, chapterId: chapter.id, title: chapter.title, eventId: null, viewpointId: null, narration: 'unspecified', goal: '', instructions: [], revisionId: chapter.revisionId }));
  return story;
}

export function sourceCurrent(source: StorySource, state: BookState): boolean {
  return isCurrentSource(source, state);
}

export class StoryStore {
  constructor(readonly book: BookStore) {}
  view(version = this.book.project().version) {
    const state = this.book.snapshot(version).state;
    const story = structuredClone(state.story ?? legacyStory(state));
    // Read-time status is a projection of the requested snapshot, never a write.
    for (const claim of story.claims) if (!sourceCurrent(claim.source, state)) claim.status = 'stale';
    for (const item of story.knowledge) if (!sourceCurrent(item.source, state) || story.claims.find(claim => claim.id === item.claimId)?.status !== 'fresh') item.status = 'stale';
    return { version, enabled: Boolean(state.story), story };
  }

  private validateSources(story: StoryState, state: BookState) {
    const chapters = new Set([...state.chapters.map(item => item.id), ...Object.keys(state.plans)]);
    for (const scene of story.scenes) {
      if (!chapters.has(scene.chapterId)) throw new Error('场景所属章节不存在。');
      if (scene.revisionId !== null && this.book.revision(scene.revisionId).chapterId !== scene.chapterId) throw new Error('场景正文不属于该章节。');
      if (scene.end !== undefined && scene.end > this.book.revision(scene.revisionId!).content.length) throw new Error('场景范围超出正文。');
    }
    for (const collection of ['events', 'claims', 'knowledge', 'disclosures', 'threads', 'rules'] as const) {
      for (const item of story[collection]) {
        const source = item.source;
        if (source.kind === 'text') resolveReference(this.book, source, new Set([source.revisionId]));
        if (source.kind === 'plan' && !sourceCurrent(source, state) && !('status' in item && item.status === 'stale')) throw new Error('计划来源已经过期。');
        if (source.kind === 'text' && !sourceCurrent(source, state) && (collection === 'claims' || collection === 'knowledge') && 'status' in item && item.status !== 'stale') throw new Error('记忆来源已过期，请保留为历史条目或重新核对。');
      }
    }
  }

  save(value: unknown, expectedVersion: number, requestId: string = randomUUID()) {
    const story = StoryShape.parse(value);
    return this.book.commit(expectedVersion, requestId, hash(JSON.stringify({ action: 'story-save', story })), state => {
      this.validateSources(story, state);
      const before = state.story;
      if (before) for (const claim of story.claims) {
        const original = before.claims.find(item => item.id === claim.id);
        if (original && JSON.stringify({ ...original, confirmed: false, status: '' }) !== JSON.stringify({ ...claim, confirmed: false, status: '' })) {
          for (const knowledge of story.knowledge.filter(item => item.claimId === claim.id)) {
            if (JSON.stringify(before.knowledge.find(item => item.id === knowledge.id)) === JSON.stringify(knowledge)) knowledge.status = 'stale';
          }
        }
      }
      state.story = StoryStateSchema.parse(story);
    });
  }

  upsert(collection: StoryCollection, value: unknown, expectedVersion: number) {
    const story = this.view().story;
    const item = z.object({ id: z.string().min(1) }).passthrough().parse(value);
    const records: unknown[] = story[collection]; const index = records.findIndex(record => (record as { id: string }).id === item.id);
    if (index < 0) records.push(item); else records[index] = item;
    return this.save(story, expectedVersion);
  }

  confirm(ids: string[], expectedVersion: number) {
    const story = this.view().story;
    if (!ids.length || new Set(ids).size !== ids.length) throw new Error('确认条目不能为空或重复。');
    for (const id of ids) {
      const claim = story.claims.find(item => item.id === id);
      if (!claim || claim.status !== 'fresh') throw new Error('只能确认当前有效来源的条目。');
      claim.confirmed = true;
    }
    return this.save(story, expectedVersion);
  }

  candidate(revisionId: string) {
    const report = new ReviewStore(this.book).latest('extractions', revisionId);
    if (!report || report.status !== 'extracted') return null;
    const row = this.book.db.prepare('SELECT payload FROM story_candidates WHERE run_id = ? AND revision_id = ?').get(report.runId, revisionId) as { payload: string } | undefined;
    return row ? { runId: report.runId, baseVersion: report.baseVersion, changes: StoryChangesSchema.parse(JSON.parse(row.payload)) } : null;
  }

  applyCandidate(revisionId: string, expectedVersion: number) {
    const candidate = this.candidate(revisionId);
    if (!candidate) throw new Error('记忆候选不存在或提取未完成。');
    const fingerprint = hash(JSON.stringify(candidate));
    return this.book.commit(expectedVersion, `story-apply:${revisionId}:${fingerprint}`, fingerprint, state => {
      if (!state.story || !state.chapters.some(item => item.revisionId === revisionId)) throw new Error('记忆候选需要先批准对应正文，且来源必须仍为当前版本。');
      const run = this.book.db.prepare('SELECT cancelled FROM runs WHERE id = ?').get(candidate.runId) as { cancelled: number };
      if (run.cancelled) throw new Error('记忆候选所属运行已取消。');
      const changes = validateStoryChanges(this.book, candidate.changes, revisionId, candidate.baseVersion);
      for (const claim of changes.claims) { claim.confirmed = false; if (claim.status !== 'stale') claim.status = 'fresh'; }
      for (const collection of ['events', 'claims', 'knowledge', 'disclosures', 'threads'] as const) (state.story[collection] as unknown[]).push(...changes[collection].filter(item => !state.story![collection].some(existing => existing.id === item.id)));
      this.validateSources(state.story, state); StoryStateSchema.parse(state.story);
    });
  }

  correct(id: string, value: unknown, expectedVersion: number) {
    const story = this.view().story; const original = story.claims.find(item => item.id === id);
    if (!original || original.status !== 'fresh') throw new Error('只能纠正当前有效的断言。');
    const replacement = StoryShape.shape.claims.element.parse(value);
    if (JSON.stringify(replacement.source) !== JSON.stringify(original.source)) throw new Error('纠正必须保留原来源，新的作者设定请另外新增。');
    original.status = 'stale';
    story.claims.push({ ...replacement, id: randomUUID(), correctsId: id, confirmed: true, status: 'fresh' });
    return this.save(story, expectedVersion);
  }
}

export const StoryCollectionSchema = z.enum(storyCollections);
