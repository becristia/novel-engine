import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, CommitService } from '../src/application/workspace.js';
import { ProposalService } from '../src/application/proposals.js';
import { defaultConfig } from '../src/domain/model-config.js';
import { BookStore } from '../src/storage/book-store.js';
import { MemoryStore } from '../src/storage/memory-store.js';
import { RunStore } from '../src/storage/run-store.js';
import { FakeProvider } from '../src/llm/fake-provider.js';
import { CreationWorkflow } from '../src/workflows/creation.js';
import { MemoryWorkflow } from '../src/workflows/memory.js';
import { buildContext } from '../src/context/builder.js';
import { blocks } from '../src/review/evidence.js';
import type { Extraction } from '../src/domain/review.js';

const config = defaultConfig(); config.model.maxOutputTokens = 2048;
const budget = { maxRequests: 16, maxTokens: 128000 };

describe('source-bound memory', () => {
  let directory: string; let book: BookStore; let memory: MemoryStore; let service: CommitService;
  beforeEach(async () => {
    await mkdir('.tmp/milestone-tests', { recursive: true }); directory = await mkdtemp(resolve('.tmp/milestone-tests/memory-'));
    createWorkspace(directory, '记忆验收'); book = new BookStore(directory); memory = new MemoryStore(book); service = new CommitService(book);
    await service.importFile('fixtures/novels/harbor-light.md', true);
    memory.setAliases('lin-zhou', ['林舟']);
    const plan = { title: '第四章 入塔', goal: '打开灯塔', characters: ['lin-zhou'], constraints: [], events: ['入塔'], targetLength: 800, viewpointCharacter: 'lin-zhou' };
    const proposal = await new CreationWorkflow(book, config, new FakeProvider([JSON.stringify({ chapters: [plan] })]), budget).plan('续写第四章。', 1);
    new ProposalService(book).approve(proposal.proposal.id);
  });
  afterEach(async () => { book.close(); await rm(directory, { recursive: true }); });

  function evidence(revisionId: string) {
    const revision = book.revision(revisionId); const block = blocks(revision.content)[1] ?? blocks(revision.content)[0]!;
    return { chapterId: revision.chapterId, revisionId, blockId: block.id, quote: block.text };
  }
  function fact(revisionId: string, overrides: Partial<Extraction['facts'][number]> = {}): Extraction['facts'][number] {
    return { subject: '林舟', relation: 'event', value: '发现灯光', kind: 'fact', characterId: null, storyTime: null, knowledgeTime: null, evidence: evidence(revisionId), ...overrides };
  }

  it('keeps unconfirmed claims out, separates beliefs/plans, and requires explicit knowledge evidence', () => {
    const revisionId = book.snapshot().state.chapters[2]!.revisionId;
    memory.ingest(revisionId, { facts: [fact(revisionId), fact(revisionId, { kind: 'belief', characterId: '林舟', value: '误信' }), fact(revisionId, { kind: 'plan', value: '明天进塔' }), fact(revisionId, { relation: 'knowledge', characterId: '林舟', value: '钥匙归属', knowledgeTime: '第三章告知事件' })] });
    expect(buildContext(book, 4, config).memory.facts).toHaveLength(0);
    memory.confirm(memory.entries().filter(entry => entry.kind === 'fact').map(entry => entry.id));
    const context = buildContext(book, 4, config);
    expect(context.memory.facts).toHaveLength(2); expect(context.memory.beliefs).toHaveLength(1); expect(context.memory.futurePlans).toHaveLength(1);
    expect(context.memory.knownByViewpoint).toHaveLength(1);
  });

  it('preserves old memory on append and invalidates it atomically when old text changes', () => {
    const first = book.snapshot().state.chapters[0]!;
    memory.ingest(first.revisionId, { facts: [fact(first.revisionId)] }); memory.confirm(memory.entries().map(entry => entry.id));
    memory.saveSummary(first.revisionId, { summary: '过时摘要中的旧事实', evidence: [evidence(first.revisionId)] });
    service.insert('附章', '## 附章\n新内容。\n', 4, book.project().version);
    expect(memory.entries().every(entry => entry.status === 'fresh')).toBe(true);
    service.replace(first.id, '## 第一章\n林舟只看见熄灭的灯塔，这是新事实。\n', book.project().version);
    expect(memory.entries().every(entry => entry.status === 'stale')).toBe(true);
    const context = JSON.stringify(buildContext(book, 4, config));
    expect(context).not.toContain('过时摘要'); expect(context).toContain('新事实');
    expect(book.snapshot().state.aliases['lin-zhou']).toEqual(['林舟']);
  });

  it('rebuilds only new or stale sources and skips already fresh chapters', async () => {
    for (const chapter of book.snapshot().state.chapters) {
      memory.ingest(chapter.revisionId, { facts: [] });
      memory.saveSummary(chapter.revisionId, { summary: '已有新鲜摘要', evidence: [evidence(chapter.revisionId)] });
    }
    service.insert('附章', '## 附章\n林舟听见海浪。\n', 4, book.project().version);
    const target = book.snapshot().state.chapters[3]!.revisionId;
    const transport = new FakeProvider(['{"facts":[]}', JSON.stringify({ summary: '林舟听见海浪', evidence: [evidence(target)] })]);
    const workflow = new MemoryWorkflow(book, config, transport, budget);
    const result = await workflow.rebuild();
    expect(result.rebuilt).toEqual([target]); expect(new RunStore(book).attempts(result.runId!)).toHaveLength(2);
    expect((await workflow.rebuild()).runId).toBeNull();
  });

  it('preserves multiple possessions and reports same-time single-value conflicts without overwriting', () => {
    const revisionId = book.snapshot().state.chapters[0]!.revisionId;
    memory.ingest(revisionId, { facts: [fact(revisionId, { relation: 'possession', value: '钥匙' }), fact(revisionId, { relation: 'possession', value: '信件' }), fact(revisionId, { relation: 'location', value: '码头', storyTime: '同一清晨' }), fact(revisionId, { relation: 'location', value: '灯塔', storyTime: '同一清晨' })] });
    memory.confirm(memory.entries().map(entry => entry.id));
    const context = buildContext(book, 4, config);
    expect(context.memory.facts).toHaveLength(4); expect(context.memory.singleValueConflicts).toHaveLength(1);
    expect(context.memory.singleValueConflicts[0]).toHaveLength(2);
  });

  it('keeps author corrections traceable and does not infer story time from chapter numbers', () => {
    const revisionId = book.snapshot().state.chapters[0]!.revisionId;
    memory.ingest(revisionId, { facts: [fact(revisionId)] }); const original = memory.entries()[0]!;
    const corrected = memory.correct(original.id, fact(revisionId, { value: '作者纠正的事件说明', storyTime: '2020 年回忆' }));
    expect(memory.entries().find(entry => entry.id === original.id)!.status).toBe('stale');
    expect(memory.entries().find(entry => entry.id === corrected.id)).toMatchObject({ parentId: original.id, origin: 'author-correction' });
    expect(JSON.stringify(buildContext(book, 4, config))).toContain('2020 年回忆');
    expect(() => memory.setAliases('another-person', ['林舟'])).toThrow('不同角色');
  });

  it('promotes author-confirmed candidate facts in the same transaction as acceptance', async () => {
    const workflow = new CreationWorkflow(book, config, new FakeProvider(['林舟走进了灯塔。']), budget);
    const candidate = await workflow.draft(4);
    memory.ingest(candidate.revision!.id, { facts: [fact(candidate.revision!.id)] });
    const pending = memory.entries().find(entry => entry.revisionId === candidate.revision!.id)!;
    const baseline = book.project().version;
    memory.confirm([pending.id]); expect(book.project().version).toBe(baseline);
    await new CreationWorkflow(book, config, new FakeProvider([JSON.stringify({ summary: '未发现问题', issues: [] }), '{"facts":[]}']), budget).review(candidate.revision!.id);
    new ProposalService(book).approve(candidate.proposal.id);
    expect(book.snapshot().state.confirmedFactIds).toContain(pending.id);
    expect(memory.entries().find(entry => entry.id === pending.id)!.status).toBe('fresh');
  });
});
