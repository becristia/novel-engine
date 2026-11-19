import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, CommitService } from '../src/application/workspace.js';
import { emptyStory, StoryStateSchema } from '../src/domain/story-memory.js';
import { BookStore } from '../src/storage/book-store.js';
import { StoryStore } from '../src/storage/story-store.js';
import { MemoryJobStore } from '../src/storage/memory-jobs.js';
import { MemoryStore } from '../src/storage/memory-store.js';
import { blocks } from '../src/review/evidence.js';
import { activeStory } from '../src/context/story-builder.js';

describe('story dependency invalidation and transactional outbox', () => {
  let directory: string; let book: BookStore; let stories: StoryStore;
  beforeEach(async () => {
    await mkdir('.tmp/story-memory-tests', { recursive: true }); directory = await mkdtemp(resolve('.tmp/story-memory-tests/invalidation-'));
    createWorkspace(directory, '失效验收'); book = new BookStore(directory); stories = new StoryStore(book);
    await new CommitService(book).importFile('fixtures/novels/harbor-light.md', true);
    const story = emptyStory(); story.entities = [{ id: 'lin', name: '林舟', aliases: [] }];
    for (const [index, chapter] of book.snapshot().state.chapters.entries()) {
      const revision = book.revision(chapter.revisionId); const block = blocks(revision.content)[1]!;
      const source = { kind: 'text' as const, chapterId: chapter.id, revisionId: revision.id, contentHash: revision.contentHash, blockId: block.id, quote: block.text };
      story.events.push({ id: `event-${index}`, title: '发现', occurrence: 'actual', source });
      story.scenes.push({ id: `scene-${index}`, chapterId: chapter.id, revisionId: revision.id, title: chapter.title, eventId: `event-${index}`, viewpointId: 'lin', narration: 'limited', goal: '调查', instructions: [] });
      story.claims.push({ id: `claim-${index}`, subjectId: 'lin', relation: 'possession', value: `物品 ${index}`, kind: 'fact', holderId: null, fromEventId: `event-${index}`, untilEventId: null, visibility: 'public', confirmed: true, status: 'fresh', source, dependsOn: [], correctsId: null });
    }
    story.claims[1]!.dependsOn = ['claims:claim-0'];
    story.knowledge.push({ id: 'knows', characterId: 'lin', claimId: 'claim-0', learnedAt: 'event-0', untilEventId: null, stance: 'knows', status: 'fresh', source: { kind: 'author', decisionId: 'knowledge' } });
    story.disclosures.push({ id: 'reveal', claimId: 'claim-0', sceneId: 'scene-0', status: 'actual', level: 'reveal', source: { kind: 'author', decisionId: 'reveal' } });
    stories.save(story, 1);
  });
  afterEach(async () => { book.close(); await rm(directory, { recursive: true }); });
  it('C09 and C11 invalidates a changed source and downstream claims atomically while preserving unrelated sources', () => {
    const before = book.snapshot(); const chapter = before.state.chapters[0]!;
    new CommitService(book).replace(chapter.id, '## 新正文\n\n林舟改变路线。', before.version);
    expect(stories.view().story.claims.map(item => item.status)).toEqual(['stale', 'stale', 'fresh']);
    expect(stories.view().story.knowledge[0]!.status).toBe('stale');
    expect(activeStory(book, book.project().version).disclosures).toHaveLength(0);
    const jobs = new MemoryJobStore(book).list(); expect(jobs).toHaveLength(4);
    expect(jobs.find(item => item.sourceId === chapter.revisionId)?.status).toBe('obsolete');
    expect(stories.view(before.version).story.claims.every(item => item.status === 'fresh')).toBe(true);
    book.close(); book = new BookStore(directory); stories = new StoryStore(book);
    expect(stories.view().story.claims[0]!.status).toBe('stale'); expect(new MemoryJobStore(book).list()).toHaveLength(4);
  });
  it('rolls back正文, snapshot and memory jobs together when the outbox write fails', () => {
    const before = book.snapshot(); const jobs = new MemoryJobStore(book).list();
    book.db.exec("CREATE TRIGGER reject_job BEFORE INSERT ON memory_jobs BEGIN SELECT RAISE(ABORT, 'simulated-outbox-failure'); END;");
    expect(() => new CommitService(book).replace(before.state.chapters[0]!.id, '## 失败\n\n不可提交。', before.version)).toThrow('simulated-outbox-failure');
    expect(book.snapshot()).toEqual(before); expect(new MemoryJobStore(book).list()).toEqual(jobs);
  });
  it('C12 persists unknown operations, refuses automatic retry and ignores late obsolete results', () => {
    const jobs = new MemoryJobStore(book); const job = jobs.list()[0]!;
    jobs.begin(job.id); jobs.recordOperation(job.id, 'external-123'); jobs.recover();
    expect(jobs.get(job.id)).toMatchObject({ status: 'unknown', externalId: 'external-123', attempts: 1 });
    expect(() => jobs.begin(job.id)).toThrow('未知结果');
    new CommitService(book).replace(book.snapshot().state.chapters[0]!.id, '## 后来\n\n全新正文。', book.project().version);
    expect(jobs.finish(job.id, 'succeeded').status).toBe('obsolete');
    expect(book.snapshot().state.story!.claims[0]!.status).toBe('stale');
  });
  it('C05 and C10 keeps explicit knowledge corrections versioned without inventing events from chapter order', () => {
    const story = stories.view().story; story.knowledge[0]!.learnedAt = 'event-2'; stories.save(story, book.project().version);
    expect(stories.view().story.knowledge[0]!.learnedAt).toBe('event-2');
    new CommitService(book).reorder(book.snapshot().state.chapters.map(item => item.id).reverse(), book.project().version);
    expect(stories.view().story.knowledge[0]!.learnedAt).toBe('event-2'); expect(stories.view(2).story.knowledge[0]!.learnedAt).toBe('event-0');
  });
  it('refuses dangling or cyclic dependency identifiers', () => {
    const story = stories.view().story; story.claims[0]!.dependsOn = ['claims:missing'];
    expect(StoryStateSchema.safeParse(story).success).toBe(false);
    story.claims[0]!.dependsOn = ['claims:claim-1']; expect(StoryStateSchema.safeParse(story).success).toBe(false);
  });
  it('does not revive a corrected legacy extraction on rebuild', () => {
    const chapter = book.snapshot().state.chapters[0]!; const revision = book.revision(chapter.revisionId); const block = blocks(revision.content)[1]!;
    const fact = { subject: '林舟', relation: 'possession' as const, value: '旧信', kind: 'fact' as const, characterId: null, storyTime: null, knowledgeTime: null, evidence: { chapterId: chapter.id, revisionId: revision.id, blockId: block.id, quote: block.text } };
    const memory = new MemoryStore(book); memory.ingest(revision.id, { facts: [fact] }); const original = memory.entries().find(item => item.kind === 'fact')!;
    memory.correct(original.id, { ...fact, value: '信封' }); memory.ingest(revision.id, { facts: [fact] });
    expect(memory.entries().find(item => item.id === original.id)?.status).toBe('stale');
    expect(memory.entries().filter(item => item.origin === 'author-correction' && item.status === 'fresh')).toHaveLength(1);
  });
});
