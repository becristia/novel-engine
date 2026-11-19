import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspace, CommitService } from '../src/application/workspace.js';
import { ProposalService } from '../src/application/proposals.js';
import { defaultConfig } from '../src/domain/model-config.js';
import { emptyStory } from '../src/domain/story-memory.js';
import { BookStore } from '../src/storage/book-store.js';
import { StoryStore } from '../src/storage/story-store.js';
import { RunStore } from '../src/storage/run-store.js';
import { FakeProvider } from '../src/llm/fake-provider.js';
import { CreationWorkflow } from '../src/workflows/creation.js';
import { blocks } from '../src/review/evidence.js';
import { replayRun } from '../src/workflows/replay.js';
import { validateStoryChanges } from '../src/review/story-extraction.js';
import { StoryChangesSchema } from '../src/domain/review.js';
import { MemoryWorkflow } from '../src/workflows/memory.js';
import { MemoryStore } from '../src/storage/memory-store.js';

const scene = (id: string, eventId: string) => ({ id, title: '调查', goal: '核对信封', instructions: [], narration: 'limited', viewpointCharacter: '林舟', eventId, revealClaimIds: [], threadIds: [] });
const plan = { title: '归港', goal: '调查失踪航次', characters: ['林舟'], constraints: [], events: [], targetLength: 800, scenes: [scene('first', 'visit'), scene('second', 'open')] };
const review = JSON.stringify({ summary: '没有明确问题。', issues: [] });
const extraction = JSON.stringify({ facts: [], story: { events: [], claims: [], knowledge: [], disclosures: [], threads: [] } });
const budget = { maxRequests: 20, maxTokens: 1000000 };

describe('scene generation and author memory acceptance', () => {
  let directory: string; let book: BookStore; let proposals: ProposalService;
  const config = defaultConfig(); config.model.contextWindowTokens = 100000; config.model.maxOutputTokens = 4096;
  const workflow = (responses: string[], customBudget = budget) => new CreationWorkflow(book, config, new FakeProvider(responses), customBudget);
  beforeEach(async () => {
    await mkdir('.tmp/story-memory-tests', { recursive: true }); directory = await mkdtemp(resolve('.tmp/story-memory-tests/workflow-'));
    createWorkspace(directory, '场景写作'); book = new BookStore(directory); proposals = new ProposalService(book);
    const story = emptyStory(); story.entities = [{ id: 'lin', name: '林舟', aliases: [] }, { id: 'gu', name: '顾宁', aliases: [] }];
    story.events = ['visit', 'open'].map(id => ({ id, title: id, occurrence: 'actual', source: { kind: 'author', decisionId: id } })); story.order = [{ before: 'visit', after: 'open' }];
    story.claims = [{ id: 'secret', subjectId: 'gu', relation: 'identity', value: '真凶', kind: 'fact', holderId: null, fromEventId: null, untilEventId: null, visibility: 'restricted', confirmed: true, status: 'fresh', source: { kind: 'author', decisionId: 'secret' }, dependsOn: [], correctsId: null }];
    new StoryStore(book).save(story, 0);
    const proposal = await workflow([JSON.stringify({ chapters: [plan] })]).plan('调查港口', 1); proposals.approve(proposal.proposal.id);
  });
  afterEach(async () => { book.close(); await rm(directory, { recursive: true }); });
  it('writes sequential scenes with run-local continuation, audits the whole chapter and preserves replay', async () => {
    const result = await workflow(['林舟看见空信封。', '他拆开封口。', review, extraction]).write(1);
    const runs = new RunStore(book); const attempts = runs.attempts(result.runId);
    expect(attempts).toHaveLength(4); expect(attempts[1]!.prompt).toContain('林舟看见空信封。');
    for (const attempt of attempts.slice(0, 2)) expect(attempt.prompt).not.toContain('顾宁');
    expect(attempts[2]!.prompt).toContain('顾宁'); expect(attempts[2]!.prompt).toContain('他拆开封口。');
    expect(book.snapshot().state.chapters).toHaveLength(0);
    proposals.approve(result.proposal.id);
    expect(new CommitService(book).exportText()).toContain('他拆开封口。');
    const ranges = book.snapshot().state.story!.scenes;
    expect(result.revision!.content.slice(ranges[0]!.start, ranges[0]!.end)).toBe('林舟看见空信封。');
    expect(replayRun(directory, result.runId)).toMatchObject({ ok: true, databaseChanges: 0 });
  });
  it('C09 and C12 resumes between scenes without regenerating the earlier scene or resetting budget', async () => {
    const save = RunStore.prototype.saveArtifact;
    const hook = vi.spyOn(RunStore.prototype, 'saveArtifact').mockImplementation(function (this: RunStore, ...args) { save.apply(this, args); if (args[1] === 'draft:scene:first') throw new Error('crash-between-scenes'); });
    try { await expect(workflow(['第一场景。']).write(1)).rejects.toThrow('crash-between-scenes'); } finally { hook.mockRestore(); }
    const row = book.db.prepare("SELECT id FROM runs WHERE kind='write' ORDER BY rowid DESC LIMIT 1").get() as { id: string };
    const result = await workflow(['第二场景。', review, extraction]).resume(row.id);
    expect(result.revision!.content).toContain('第一场景。'); expect(new RunStore(book).attempts(row.id)).toHaveLength(4);
    expect(new RunStore(book).get(row.id).budget).toEqual(budget);
  });
  it('C12 stops at the shared request ceiling and leaves no formal story changes', async () => {
    await expect(workflow(['第一场景。', '第二场景。'], { maxRequests: 1, maxTokens: 1000000 }).write(1)).rejects.toThrow('预算不足');
    expect(book.snapshot().state.chapters).toHaveLength(0); expect(book.snapshot().state.story!.claims).toHaveLength(1);
  });
  it('keeps extracted beliefs unconfirmed until separate chapter adoption and memory confirmation', async () => {
    const candidate = await workflow(['林舟相信信封属于沈砚。', '他小心收起信封。']).draft(1);
    const revision = candidate.revision!; const block = blocks(revision.content)[1]!;
    const source = { kind: 'text', chapterId: revision.chapterId, revisionId: revision.id, contentHash: revision.contentHash, blockId: block.id, quote: block.text };
    const changes = { events: [], claims: [{ id: 'belief', subjectId: 'lin', relation: 'possession', value: '认为信封属于沈砚', kind: 'belief', holderId: 'lin', fromEventId: 'visit', untilEventId: null, visibility: 'public', confirmed: false, status: 'pending', source, dependsOn: [], correctsId: null }], knowledge: [], disclosures: [], threads: [] };
    await workflow([review, JSON.stringify({ facts: [], story: changes })]).review(revision.id);
    const stories = new StoryStore(book);
    expect(() => stories.applyCandidate(revision.id, book.project().version)).toThrow('先批准');
    proposals.approve(candidate.proposal.id); expect(stories.view().story.claims).toHaveLength(1);
    const adopted = stories.applyCandidate(revision.id, book.project().version); expect(stories.applyCandidate(revision.id, adopted.version).version).toBe(adopted.version);
    const belief = stories.view().story.claims.find(item => item.kind === 'belief')!; expect(belief.confirmed).toBe(false);
    stories.confirm([belief.id], book.project().version); expect(stories.view().story.claims.find(item => item.id === belief.id)).toMatchObject({ kind: 'belief', confirmed: true });
    stories.correct(belief.id, { ...belief, value: '只怀疑信封属于沈砚' }, book.project().version);
    const repeated = validateStoryChanges(book, StoryChangesSchema.parse(changes), revision.id, book.project().version);
    expect(repeated.claims[0]!.status).toBe('stale');
    new MemoryStore(book).setConstraints(['保持当前称谓。'], book.project().version);
    const rebuilt = new MemoryWorkflow(book, config, new FakeProvider([JSON.stringify({ facts: [], story: changes }), JSON.stringify({ summary: '林舟收起信封。', evidence: [{ chapterId: revision.chapterId, revisionId: revision.id, blockId: block.id, quote: block.text }] })]), budget);
    await rebuilt.rebuild(); stories.applyCandidate(revision.id, book.project().version);
    expect(stories.view().story.claims.find(item => item.id === belief.id)?.status).toBe('stale');
    expect(stories.view().story.claims.filter(item => item.kind === 'belief' && item.status === 'fresh')).toHaveLength(0);
    expect(replayRun(directory, candidate.runId).ok).toBe(true);
  });
  it('rejects extractors that invent author authority or current-candidate cross references', async () => {
    const candidate = await workflow(['正文。', '后续。']).draft(1);
    expect(() => validateStoryChanges(book, { events: [{ id: 'bad', title: '假事件', occurrence: 'actual', source: { kind: 'author', decisionId: 'forged' } }], claims: [], knowledge: [], disclosures: [], threads: [] }, candidate.revision!.id, book.project().version)).toThrow('只能引用');
    proposals.reject(candidate.proposal.id); expect(book.snapshot().state.story!.events).toHaveLength(2);
  });
  it('C09 regenerates every dependent scene on revision and never forwards global review suggestions', async () => {
    const draft = await workflow(['旧场景一。', '旧场景二。']).draft(1);
    const revised = await workflow(['新场景一。', '新场景二。', review, extraction]).revise(draft.revision!.id, '加强衔接。');
    const attempts = new RunStore(book).attempts(revised.runId); expect(attempts).toHaveLength(4);
    expect(attempts[1]!.prompt).toContain('新场景一。'); expect(attempts[1]!.prompt).not.toContain('旧场景一。');
  });
  it('rejects plan-backed actual events and correction cycles', () => {
    const state = new StoryStore(book).view().story;
    state.events[0]!.source = { kind: 'plan', chapterId: Object.keys(book.snapshot().state.plans)[0]!, revisionId: Object.values(book.snapshot().state.plans)[0]!.revisionId };
    expect(() => new StoryStore(book).save(state, book.project().version)).toThrow();
    const claims = new StoryStore(book).view().story; claims.claims.push({ ...claims.claims[0]!, id: 'second-secret', correctsId: 'secret' }); claims.claims[0]!.correctsId = 'second-secret';
    expect(() => new StoryStore(book).save(claims, book.project().version)).toThrow();
  });
});
