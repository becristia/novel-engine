import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BookStore } from '../src/storage/book-store.js';
import { StoryStore } from '../src/storage/story-store.js';
import { createWorkspace, CommitService } from '../src/application/workspace.js';
import { StoryStateSchema } from '../src/domain/story-memory.js';
import type { StoryState } from '../src/domain/story-memory.js';
import { AppConfigSchema } from '../src/domain/model-config.js';
import { buildSceneContext, activeStory, contextRevisionIds } from '../src/context/story-builder.js';
import { ContextSchema, buildContext } from '../src/context/builder.js';
import { blocks } from '../src/review/evidence.js';

describe('scene context boundaries', () => {
  let directory: string; let book: BookStore; let story: StoryState;
  const config = AppConfigSchema.parse({ schemaVersion: 1, model: { provider: 'fake', modelId: 'fake-v1', contextWindowTokens: 100000, maxOutputTokens: 1000 } });
  beforeEach(async () => {
    await mkdir('.tmp/story-memory-tests', { recursive: true }); directory = await mkdtemp(resolve('.tmp/story-memory-tests/context-'));
    createWorkspace(directory, '场景验收'); book = new BookStore(directory);
    await new CommitService(book).importFile('fixtures/novels/harbor-light.md', true);
    story = StoryStateSchema.parse(JSON.parse(readFileSync('fixtures/story-memory/harbor.json', 'utf8')));
    book.commit(1, 'plans', 'plans', state => { story.scenes.forEach((scene, i) => {
      const chapter = state.chapters[i]!; scene.chapterId = chapter.id; scene.revisionId = chapter.revisionId;
      state.plans[chapter.id] = { chapterId: chapter.id, revisionId: `plan-${i}`, ordinal: i + 1, title: chapter.title, goal: '顾宁是真凶', characters: ['林舟', '顾宁'], constraints: [], events: [], targetLength: 2000 };
    }); });
  });
  afterEach(async () => { book.close(); await rm(directory, { recursive: true }); });
  const save = () => new StoryStore(book).save(story, book.project().version);
  it('C01 keeps belief and a due thread but excludes global secret, full chapters and unsafe plan fields', () => {
    save(); const view = buildContext(book, 2, config); ContextSchema.parse(view);
    const input = JSON.stringify(view);
    expect(input).not.toContain('顾宁'); expect(view.sources.some(item => item.id === 'mistake')).toBe(true);
    expect(view.sources.some(item => item.id === 'letter')).toBe(true);
    expect(view.omissions).toContainEqual({ id: 'killer', reason: 'knowledge-unknown-or-not-yet' });
    expect(view.sources.some(item => ['chapter', 'summary', 'plan'].includes(item.kind))).toBe(false);
    expect(contextRevisionIds(view)).toEqual([]);
  });
  it('C02 uses story time in a flashback, never chapter number', () => {
    story.scenes[1]!.eventId = 'crime'; save();
    expect(buildContext(book, 2, config).sources.some(item => item.id === 'mistake')).toBe(false);
  });
  it('C03 no knowledge evidence never becomes known automatically', () => {
    story.knowledge = []; save(); expect(buildContext(book, 2, config).sources.some(item => item.kind === 'story-claim')).toBe(false);
  });
  it('C04 rejects a mixed evidence span while retaining its allowed proposition', () => {
    const chapter = book.snapshot().state.chapters[0]!; const revision = book.revision(chapter.revisionId); const block = blocks(revision.content)[1]!;
    const source = { kind: 'text' as const, chapterId: chapter.id, revisionId: revision.id, blockId: block.id, quote: block.text, contentHash: revision.contentHash };
    story.claims[0]!.source = source; story.claims[1]!.source = source; save();
    const context = buildContext(book, 2, config);
    expect(context.sources.some(item => item.kind === 'text-range')).toBe(false);
    expect(JSON.stringify(context)).not.toContain(block.text);
  });
  it('provides global review separately and a target-only extractor dictionary', () => {
    save(); const reviewer = buildSceneContext(book, 'investigation', config, book.project().version, 'reviewer');
    expect(JSON.stringify(reviewer)).toContain('顾宁');
    const extractor = buildSceneContext(book, 'investigation', config, book.project().version, 'extractor');
    expect(extractor.sources).toHaveLength(1); expect(JSON.stringify(extractor)).not.toContain('真凶');
  });
  it('C10 reorders disclosures with chapter snapshots and filters stale evidence', () => {
    story.scenes[1]!.narration = 'omniscient'; save();
    expect(buildContext(book, 2, config).sources.some(item => item.id === 'killer')).toBe(true);
    book.commit(book.project().version, 'reorder', 'reorder', state => { state.chapters.reverse(); });
    expect(buildContext(book, 2, config).sources.some(item => item.id === 'killer')).toBe(false);
    expect(activeStory(book, 3).scenes[0]!.id).toBe('reader-reveal');
  });
  it('C14 rejects unsafe instructions and oversized hard rules instead of truncating', () => {
    story.scenes[1]!.instructions = ['提示顾宁是真凶。']; save(); expect(() => buildContext(book, 2, config)).toThrow('不可用信息');
    story.scenes[1]!.instructions = []; story.rules[0]!.text = '必须保持语气。'.repeat(5000); save();
    expect(() => buildContext(book, 2, { ...config, model: { ...config.model, contextWindowTokens: 10000 } })).toThrow('超出预算');
  });
  it('keeps unknown narration blocked and queries read-only', () => {
    story.scenes[1]!.narration = 'unspecified'; save(); const before = book.db.prepare('SELECT total_changes() AS n').get();
    expect(() => buildContext(book, 2, config)).toThrow('叙述方式未确定');
    expect(book.db.prepare('SELECT total_changes() AS n').get()).toEqual(before);
  });
  it('never silently drops chapter hard constraints and preserves room for due threads', () => {
    save();
    book.commit(book.project().version, 'safe-constraint', 'safe-constraint', state => { Object.values(state.plans)[1]!.constraints = ['保留对话语气。']; });
    expect(JSON.stringify(buildContext(book, 2, config))).toContain('保留对话语气。');
    book.commit(book.project().version, 'unsafe-constraint', 'unsafe-constraint', state => { Object.values(state.plans)[1]!.constraints = ['顾宁是真凶。']; });
    expect(() => buildContext(book, 2, config)).toThrow('硬约束');
  });
  it('permits an explicit planned revelation only as learning within that target scene', () => {
    story.disclosures.push({ id: 'future-reveal', claimId: 'killer', sceneId: 'truth', level: 'reveal', status: 'planned', source: { kind: 'author', decisionId: 'future' } }); save();
    expect(buildContext(book, 2, config).sources.some(item => item.id === 'killer')).toBe(false);
    const target = buildSceneContext(book, 'truth', config);
    expect(target.sources.find(item => item.id === 'killer')?.reason).toBe('learn-in-this-scene');
    expect(target.sources.find(item => item.id === 'killer')?.text).toContain('不能写成此前已知');
  });
  it('ranks optional local memories within budget without losing the mandatory thread', () => {
    for (let i = 0; i < 30; i += 1) story.claims.push({ ...story.claims[1]!, id: `memory-${i}`, value: `林舟的第 ${i} 个想法。${'文字'.repeat(50)}` });
    story.knowledge.push(...story.claims.slice(2).map((claim, i) => ({ ...story.knowledge[0]!, id: `known-${i}`, claimId: claim.id })));
    save(); const context = buildContext(book, 2, { ...config, model: { ...config.model, contextWindowTokens: 10000 } });
    expect(context.sources.some(item => item.id === 'letter')).toBe(true); expect(context.omissions?.some(item => item.reason === 'budget')).toBe(true); expect(context.estimatedTokens).toBeLessThan(10000);
  });
});
