import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { createWorkspace, CommitService } from '../src/application/workspace.js';
import { ProposalService } from '../src/application/proposals.js';
import { defaultConfig } from '../src/domain/model-config.js';
import { BookStore } from '../src/storage/book-store.js';
import { RunStore } from '../src/storage/run-store.js';
import { FakeProvider } from '../src/llm/fake-provider.js';
import { CreationWorkflow } from '../src/workflows/creation.js';
import { replayRun } from '../src/workflows/replay.js';

it('completes ten chapters with a mid-book author edit, rejection, review, acceptance and replay', async () => {
  await mkdir('.tmp/milestone-tests', { recursive: true }); const directory = await mkdtemp(resolve('.tmp/milestone-tests/long-'));
  createWorkspace(directory, '十章固定回归'); const book = new BookStore(directory);
  try {
    const config = defaultConfig(); config.model.maxOutputTokens = 4096; config.model.contextWindowTokens = 65536;
    const budget = { maxRequests: 8, maxTokens: 200000 }; const approvals = new ProposalService(book); const service = new CommitService(book);
    const plans = Array.from({ length: 10 }, (_, index) => ({ title: `第 ${index + 1} 章`, goal: '推进海港调查', characters: ['林舟'], constraints: [], events: [], targetLength: 800 }));
    const workflow = (responses: string[]) => new CreationWorkflow(book, config, new FakeProvider(responses), budget);
    const planned = await workflow([JSON.stringify({ chapters: plans })]).plan('写十章。', 10); approvals.approve(planned.proposal.id);
    const runIds: string[] = [];
    for (let chapter = 1; chapter <= 10; chapter += 1) {
      if (chapter === 6) {
        const first = book.snapshot().state.chapters[0]!;
        service.replace(first.id, '## 第 1 章\n林舟记下作者补充的正式线索。\n', book.project().version);
      }
      if (chapter === 8) {
        const rejected = await workflow(['不能进入正式稿的失败候选。']).draft(8); approvals.reject(rejected.proposal.id);
      }
      const result = await workflow([`林舟完成第 ${chapter} 次调查。`, JSON.stringify({ summary: '固定响应未报告问题', issues: [] }), '{"facts":[]}']).write(chapter);
      if (chapter === 6) expect(JSON.stringify(new RunStore(book).get(result.runId).input)).toContain('作者补充的正式线索');
      approvals.approve(result.proposal.id); runIds.push(result.runId);
    }
    expect(book.snapshot().state.chapters).toHaveLength(10);
    const output = service.exportText(); expect(output).toContain('第 10 次调查'); expect(output).toContain('作者补充'); expect(output).not.toContain('失败候选');
    expect(service.exportText(2)).toContain('第 1 次调查');
    const version = book.project().version;
    for (const id of runIds) expect(replayRun(directory, id).ok).toBe(true);
    expect(book.project().version).toBe(version);
  } finally { book.close(); await rm(directory, { recursive: true }); }
});
