import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspace, CommitService } from '../src/application/workspace.js';
import { ProposalService } from '../src/application/proposals.js';
import { defaultConfig } from '../src/domain/model-config.js';
import { BookStore } from '../src/storage/book-store.js';
import { RunStore } from '../src/storage/run-store.js';
import { FakeProvider } from '../src/llm/fake-provider.js';
import { CreationWorkflow } from '../src/workflows/creation.js';
import { resolveReference, blocks } from '../src/review/evidence.js';

const plan = { title: '第一章 归港', goal: '发现灯光', characters: ['林舟'], constraints: [], events: ['见到灯光'], targetLength: 800 };
const cleanReview = JSON.stringify({ summary: '未发现明确问题。', issues: [] });
const emptyFacts = '{"facts":[]}';
const budget = { maxRequests: 8, maxTokens: 64000 };

describe('review and acceptance workflow', () => {
  let directory: string; let book: BookStore; let proposals: ProposalService;
  const config = defaultConfig(); config.model.maxOutputTokens = 2048;
  const workflow = (responses: string[]) => new CreationWorkflow(book, config, new FakeProvider(responses), budget);
  beforeEach(async () => {
    await mkdir('.tmp/milestone-tests', { recursive: true }); directory = await mkdtemp(resolve('.tmp/milestone-tests/completion-'));
    createWorkspace(directory, '闭环验收'); book = new BookStore(directory); proposals = new ProposalService(book);
    const created = await workflow([JSON.stringify({ chapters: [plan, { ...plan, title: '第二章 寻迹' }, { ...plan, title: '第三章 交钥' }] })]).plan('写三章。', 3);
    proposals.approve(created.proposal.id);
  });
  afterEach(async () => { book.close(); await rm(directory, { recursive: true }); });

  it('accepts three chapters, revises the second, and exports only final accepted text', async () => {
    const first = await workflow(['第一章正式正文。', cleanReview, emptyFacts]).write(1); proposals.approve(first.proposal.id);
    const second = await workflow(['第二章旧候选。']).draft(2);
    const revised = await workflow(['第二章修订候选。', cleanReview, emptyFacts]).revise(second.revision!.id, '明确结尾。');
    proposals.approve(revised.proposal.id);
    const third = await workflow(['第三章正式正文。', cleanReview, emptyFacts]).write(3); proposals.approve(third.proposal.id);
    const output = new CommitService(book).exportText();
    expect(output).toContain('第二章修订候选'); expect(output).not.toContain('第二章旧候选');
    expect(book.snapshot().state.chapters).toHaveLength(3);
    expect(proposals.approve(third.proposal.id).version).toBe(book.project().version);
    expect(book.db.prepare('SELECT count(*) AS n FROM approvals WHERE revision_id IS NOT NULL').get()).toEqual({ n: 3 });
  });

  it('blocks approval without a valid report and on invalid evidence', async () => {
    const candidate = await workflow(['需要检查的正文。']).draft(1);
    expect(() => proposals.approve(candidate.proposal.id)).toThrow('审稿');
    const bad = JSON.stringify({ summary: '有问题', issues: [{ id: 'bad', kind: 'conflict', message: '冲突', suggestion: '修改', evidence: [{ chapterId: candidate.revision!.chapterId, revisionId: candidate.revision!.id, blockId: 'b2', quote: '不存在的原文' }] }] });
    await expect(workflow([bad]).review(candidate.revision!.id)).rejects.toThrow('引用原文不存在');
    expect(() => proposals.approve(candidate.proposal.id)).toThrow('有效审稿报告');
    expect(new CommitService(book).exportText()).toBe('');
  });

  it('requires author reasons for subjective review findings', async () => {
    const candidate = await workflow(['节奏缓慢的正文。']).draft(1);
    const style = JSON.stringify({ summary: '风格意见', issues: [{ id: 'style-1', kind: 'style', message: '节奏偏慢', suggestion: '考虑缩短', evidence: [{ chapterId: candidate.revision!.chapterId, revisionId: candidate.revision!.id, blockId: 'b2', quote: '节奏缓慢的正文。' }] }] });
    await workflow([style, emptyFacts]).review(candidate.revision!.id);
    expect(() => proposals.approve(candidate.proposal.id)).toThrow('--reason');
    expect(proposals.approve(candidate.proposal.id, '保留缓慢节奏作为铺垫。').version).toBe(2);
  });

  it('recovers saved model output without consuming another response', async () => {
    const receive = RunStore.prototype.receive;
    const hook = vi.spyOn(RunStore.prototype, 'receive').mockImplementationOnce(function (this: RunStore, ...args) {
      receive.apply(this, args);
      throw new Error('simulated-crash-after-response');
    });
    try { await expect(workflow(['可恢复的正文。']).draft(1)).rejects.toThrow('simulated-crash'); }
    finally { hook.mockRestore(); }
    const runs = new RunStore(book);
    const latest = book.db.prepare("SELECT id FROM runs WHERE kind = 'draft' ORDER BY rowid DESC LIMIT 1").get() as { id: string };
    const run = runs.get(latest.id);
    expect(book.db.prepare("SELECT count(*) AS n FROM proposals WHERE kind = 'draft'").get()).toEqual({ n: 0 });
    const recovered = await workflow([]).resume(run.id);
    expect(recovered.revision!.content).toContain('可恢复的正文');
    expect(runs.attempts(run.id)).toHaveLength(1);
  });

  it('limits automatic revision to one round and binds the final report to the final text', async () => {
    let drafts = 0; let reviews = 0;
    const transport = { generateText: async (request: { prompt: string }) => {
      let value: string;
      if (request.prompt.startsWith('你是小说审稿助手')) {
        reviews += 1;
        const id = /"targetRevisionId":"([^"]+)"/u.exec(request.prompt)![1]!;
        const revision = book.revision(id); const block = blocks(revision.content)[1]!;
        value = JSON.stringify({ summary: '保留风格意见', issues: [{ id: `style-${reviews}`, kind: 'style', message: '可更精练', suggestion: '缩短', evidence: [{ chapterId: revision.chapterId, revisionId: id, blockId: block.id, quote: block.text }] }] });
      } else if (request.prompt.startsWith('从目标候选正文')) value = emptyFacts;
      else { drafts += 1; value = `第 ${drafts} 次候选正文。`; }
      return { value, modelId: 'fake-v1', usage: null };
    } };
    const result = await new CreationWorkflow(book, config, transport, budget).write(1, true);
    expect(drafts).toBe(2); expect(reviews).toBe(2);
    expect(result.review!.revisionId).toBe(result.revision!.id);
    expect(result.revision!.content).toContain('第 2 次');
    expect(() => proposals.approve(result.proposal.id)).toThrow('--reason');
  });

  it('does not reuse a previous candidate report for a rewritten candidate', async () => {
    const initial = await workflow(['旧候选正文。', cleanReview, emptyFacts]).write(1);
    const replacement = await workflow(['全新候选正文。']).draft(1);
    expect(() => proposals.approve(replacement.proposal.id)).toThrow('审稿');
    expect(proposals.approve(initial.proposal.id).version).toBe(2);
    expect(() => proposals.approve(replacement.proposal.id)).toThrow('版本冲突');
  });

  it('uses UTF-16 evidence offsets and refuses ambiguous quotations', async () => {
    const candidate = await workflow(['🔑钥匙。钥匙。']).draft(1);
    const revision = candidate.revision!; const block = blocks(revision.content)[1]!;
    const reference = { chapterId: revision.chapterId, revisionId: revision.id, blockId: 'b2', quote: '钥匙。' };
    expect(() => resolveReference(book, reference, new Set([revision.id]))).toThrow('定位不唯一');
    const precise = resolveReference(book, { ...reference, start: block.start + 2, end: block.start + 5 }, new Set([revision.id]));
    expect(precise.contentHash).toBe(revision.contentHash);
  });
});
