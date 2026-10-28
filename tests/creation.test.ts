import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, CommitService } from '../src/application/workspace.js';
import { ProposalService } from '../src/application/proposals.js';
import { defaultConfig } from '../src/domain/model-config.js';
import { PlanPayloadSchema } from '../src/domain/planning.js';
import { BookStore } from '../src/storage/book-store.js';
import { RunStore } from '../src/storage/run-store.js';
import { FakeProvider } from '../src/llm/fake-provider.js';
import { CreationWorkflow } from '../src/workflows/creation.js';
import { WriteLease } from '../src/workflows/lease.js';
import { buildContext } from '../src/context/builder.js';

const content = { title: '第一章 归港', goal: '发现灯光', characters: ['林舟'], constraints: ['林舟不知道钥匙归属'], events: ['见到灯光'], targetLength: 800 };
const planResponse = JSON.stringify({ chapters: [content, { ...content, title: '第二章 寻迹' }, { ...content, title: '第三章 交钥' }] });
const budget = { maxRequests: 8, maxTokens: 64000 };

describe('planning and candidate isolation', () => {
  let directory: string; let book: BookStore; let proposals: ProposalService;
  beforeEach(async () => {
    await mkdir('.tmp/milestone-tests', { recursive: true });
    directory = await mkdtemp(resolve('.tmp/milestone-tests/creation-'));
    createWorkspace(directory, '港口旧灯'); book = new BookStore(directory); proposals = new ProposalService(book);
  });
  afterEach(async () => { book.close(); await rm(directory, { recursive: true }); });
  const config = defaultConfig();

  it('requires approved plans, supports editing, and preserves idempotent approval', async () => {
    const workflow = new CreationWorkflow(book, config, new FakeProvider([planResponse]), budget);
    const result = await workflow.plan('写三章灯塔故事。', 3);
    expect(book.project().version).toBe(0);
    expect(() => buildContext(book, 1, config)).toThrow('已批准计划');
    const edited = proposals.editPlan(result.proposal.id, 2, { ...content, title: '修改后的第二章' });
    expect(() => proposals.approve(result.proposal.id)).toThrow('不能批准');
    expect(proposals.approve(edited.id).version).toBe(1);
    expect(proposals.approve(edited.id).version).toBe(1);
    const payload = PlanPayloadSchema.parse(edited.payload);
    expect(book.snapshot().state.plans[payload.plans[1]!.chapterId]!.title).toBe('修改后的第二章');
  });

  it('keeps rejected and unreviewed candidates out of official text and context', async () => {
    const planned = await new CreationWorkflow(book, config, new FakeProvider([planResponse]), budget).plan('写三章。', 3);
    proposals.approve(planned.proposal.id);
    const first = await new CreationWorkflow(book, config, new FakeProvider(['拒绝的候选正文。']), budget).draft(1);
    expect(() => proposals.approve(first.proposal.id)).toThrow('审稿');
    proposals.reject(first.proposal.id);
    const next = await new CreationWorkflow(book, config, new FakeProvider(['新的候选正文。']), budget).draft(1);
    expect(next.revision!.content).toContain('新的候选');
    expect(new CommitService(book).exportText()).toBe('');
    expect(JSON.stringify(buildContext(book, 1, config))).not.toContain('拒绝的候选正文');
    expect(() => buildContext(book, 2, config)).toThrow('前序章节');
  });

  it('rejects context overflow without discarding constraints', async () => {
    const planned = await new CreationWorkflow(book, config, new FakeProvider([planResponse]), budget).plan('写三章。', 3);
    proposals.approve(planned.proposal.id);
    const tiny = defaultConfig(); tiny.model.contextWindowTokens = 100;
    expect(() => buildContext(book, 1, tiny)).toThrow('未静默截断');
  });

  it('allows only one current write lease and fences a superseded owner', () => {
    const runs = new RunStore(book);
    const one = runs.create('test', {}, config, budget); const two = runs.create('test', {}, config, budget);
    const a = new WriteLease(runs, one.id); const b = new WriteLease(runs, two.id);
    a.acquire();
    try {
      expect(() => b.acquire()).toThrow('写入权');
      book.db.prepare('UPDATE write_lease SET expires_at = 0').run();
      b.acquire();
      expect(() => a.assert()).toThrow('写入权已失效');
      a.release(); b.assert();
    } finally { a.release(); b.release(); }
  });

  it('rejects an old plan after the manuscript baseline changed', async () => {
    const planned = await new CreationWorkflow(book, config, new FakeProvider([planResponse]), budget).plan('写三章。', 3);
    new CommitService(book).insert('作者正文', '作者直接写下的内容。', 1, 0);
    expect(() => proposals.approve(planned.proposal.id)).toThrow('版本冲突');
  });
});
