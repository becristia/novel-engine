import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BookStore } from '../src/storage/book-store.js';
import { legacyStory, StoryStore } from '../src/storage/story-store.js';
import { CommitService, createWorkspace } from '../src/application/workspace.js';
import { StoryStateSchema } from '../src/domain/story-memory.js';
import { blocks } from '../src/review/evidence.js';
import { runCli } from '../src/cli/program.js';

describe('versioned story persistence and migration', () => {
  let directory: string; let book: BookStore; let story: StoryStore;
  beforeEach(async () => {
    await mkdir('.tmp/story-memory-tests', { recursive: true }); directory = await mkdtemp(resolve('.tmp/story-memory-tests/storage-'));
    createWorkspace(directory, '记忆验收'); book = new BookStore(directory); story = new StoryStore(book);
    await new CommitService(book).importFile('fixtures/novels/harbor-light.md', true);
  });
  afterEach(async () => { if (book.db.open) book.close(); await rm(directory, { recursive: true }); });
  const state = () => {
    const value = StoryStateSchema.parse(JSON.parse(readFileSync('fixtures/story-memory/harbor.json', 'utf8')));
    value.scenes.forEach((scene, i) => { const chapter = book.snapshot().state.chapters[i]!; scene.chapterId = chapter.id; scene.revisionId = chapter.revisionId; });
    return value;
  };
  it('C13 projects legacy chapters with unknown time and narration without writing', () => {
    const before = book.db.prepare('SELECT total_changes() AS n').get();
    const view = story.view(); expect(view.enabled).toBe(false); expect(view.story.scenes).toHaveLength(3);
    expect(view.story.scenes.every(scene => scene.narration === 'unspecified' && scene.eventId === null && scene.viewpointId === null)).toBe(true);
    expect(book.db.prepare('SELECT total_changes() AS n').get()).toEqual(before);
  });
  it('stores a new story snapshot without rewriting old snapshots or exports', () => {
    const previous = book.db.prepare('SELECT state FROM snapshots WHERE version=1').get();
    const manuscript = new CommitService(book).exportText(1);
    expect(story.save(state(), 1).version).toBe(2);
    expect(story.view().story.claims).toHaveLength(2); expect(story.view(1).enabled).toBe(false);
    expect(book.db.prepare('SELECT state FROM snapshots WHERE version=1').get()).toEqual(previous);
    expect(new CommitService(book).exportText(2)).toBe(manuscript);
  });
  it('C05 maps an explicitly registered alias to its stable identity only once', () => {
    const snapshot = book.snapshot().state;
    snapshot.aliases = { 'lin-zhou': ['林舟', '小林'] };
    snapshot.plans.test = { chapterId: 'test', revisionId: 'p1', ordinal: 4, title: '归来', goal: '核对航次', characters: ['林舟', '小林', '沈砚'], constraints: [], events: [], targetLength: 1000 };
    const mapped = legacyStory(snapshot);
    expect(mapped.entities.map(item => item.name)).toEqual(['lin-zhou', '沈砚']);
    expect(StoryStateSchema.safeParse(mapped).success).toBe(true);
  });
  it('marks old knowledge stale before validating a corrected claim kind', () => {
    const value = state(); value.knowledge = [{ ...value.knowledge[0]!, claimId: 'killer', stance: 'knows' }];
    story.save(value, 1);
    story.upsert('claims', { ...value.claims[0]!, kind: 'rumor', holderId: 'lin' }, 2);
    expect(story.view().story.knowledge[0]!.status).toBe('stale');
  });
  it('keeps confirmation separate from belief kind, rejects stale writes and replays a saved identity', () => {
    const value = state(); value.claims[1]!.confirmed = false;
    expect(story.save(value, 1, 'story-request').version).toBe(2);
    expect(story.save(value, 1, 'story-request').version).toBe(2);
    story.confirm(['mistake'], 2); expect(story.view().story.claims[1]!.kind).toBe('belief');
    expect(() => story.save(value, 1)).toThrow('版本冲突');
  });
  it('C14 rejects fake sources and cross-chapter scene revisions atomically', () => {
    const value = state(); const chapter = book.snapshot().state.chapters[0]!; const revision = book.revision(chapter.revisionId); const block = blocks(revision.content)[1]!;
    value.claims[0]!.source = { kind: 'text', chapterId: chapter.id, revisionId: revision.id, contentHash: revision.contentHash, blockId: block.id, quote: '不存在的原句' };
    expect(() => story.save(value, 1)).toThrow('引用'); expect(book.project().version).toBe(1);
    value.claims[0]!.source = { kind: 'author', decisionId: 'author' }; value.scenes[0]!.revisionId = value.scenes[1]!.revisionId;
    expect(() => story.save(value, 1)).toThrow('不属于'); expect(book.project().version).toBe(1);
  });
  it('makes unchanged knowledge stale when its proposition is edited', () => {
    const value = state(); story.save(value, 1);
    story.upsert('claims', { ...value.claims[1]!, value: '人物改变了怀疑对象。' }, 2);
    expect(story.view().story.knowledge[0]!.status).toBe('stale');
    expect(story.view(2).story.knowledge[0]!.status).toBe('fresh');
  });
  it('C13 creates a readable pre-upgrade backup and preserves old contents', async () => {
    const original = book.db.prepare('SELECT state FROM snapshots WHERE version=1').get();
    book.db.exec('DROP TABLE story_candidates; DROP TABLE memory_jobs; PRAGMA user_version=7;'); book.close();
    book = new BookStore(directory); story = new StoryStore(book);
    expect(book.db.pragma('user_version', { simple: true })).toBe(8);
    const files = await readdir(join(directory, 'backups')); expect(files).toHaveLength(1);
    const backup = new Database(join(directory, 'backups', files[0]!), { readonly: true });
    try { expect(backup.pragma('user_version', { simple: true })).toBe(7); expect(backup.prepare('SELECT state FROM snapshots WHERE version=1').get()).toEqual(original); }
    finally { backup.close(); }
    expect(book.db.prepare('SELECT state FROM snapshots WHERE version=1').get()).toEqual(original);
    book.close(); book = new BookStore(directory); expect(await readdir(join(directory, 'backups'))).toEqual(files);
  });
  it('exposes read-only history through the compiled command registration', async () => {
    let output = ''; const code = await runCli(['--project', directory, 'story', 'show', '--version', '1'], { stdout: text => { output += text; }, stderr: text => { output += text; } });
    expect(code).toBe(0); expect(JSON.parse(output)).toMatchObject({ version: 1, enabled: false });
    expect(book.project().version).toBe(1);
  });
});
