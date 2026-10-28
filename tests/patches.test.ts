import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, CommitService } from '../src/application/workspace.js';
import { ProposalService } from '../src/application/proposals.js';
import { defaultConfig } from '../src/domain/model-config.js';
import { SelectionSchema } from '../src/domain/patch.js';
import { BookStore } from '../src/storage/book-store.js';
import { FakeProvider } from '../src/llm/fake-provider.js';
import { ImpactWorkflow } from '../src/workflows/impact.js';
import { RunStore } from '../src/storage/run-store.js';
import { CreationWorkflow } from '../src/workflows/creation.js';
import { PatchService, normalizeImpact } from '../src/proposals/patches.js';

const config = defaultConfig(); config.model.maxOutputTokens = 2048;
const budget = { maxRequests: 8, maxTokens: 64000 };
const clean = JSON.stringify({ summary: '未发现明确问题', issues: [] });

describe('partial revision and undo', () => {
  let directory: string; let book: BookStore; let patch: PatchService; let approvals: ProposalService;
  beforeEach(async () => {
    await mkdir('.tmp/milestone-tests', { recursive: true }); directory = await mkdtemp(resolve('.tmp/milestone-tests/patch-'));
    createWorkspace(directory, '局部修改验收'); book = new BookStore(directory); patch = new PatchService(book); approvals = new ProposalService(book);
    await new CommitService(book).importFile('fixtures/novels/harbor-light.md', true);
  });
  afterEach(async () => { book.close(); await rm(directory, { recursive: true }); });

  function group(index: number, quote: string, replacement: string, dependsOn: string[] = []) {
    const chapter = book.snapshot().state.chapters[index]!;
    return { id: `g${index + 1}`, reason: '作者要求局部修改', dependsOn, changes: [{ target: { chapterId: chapter.id, revisionId: chapter.revisionId, blockId: 'b2', quote }, replacement }] };
  }
  function output() { return { impacts: [], groups: [group(0, '码头', '远处的港口'), group(1, '潮汐表', '航海日志'), group(2, '天亮后', '三日后', ['g2'])] }; }
  async function analyze(value = output()) {
    const source = book.snapshot().state.chapters[0]!.id;
    return new ImpactWorkflow(book, config, new FakeProvider([JSON.stringify(value)]), budget).analyze(source, '调整地点和调查资料，推迟进塔。');
  }
  async function reviewSelection(id: string) {
    const selected = SelectionSchema.parse(patch.proposals.get(id).payload);
    for (const draft of selected.drafts) await new CreationWorkflow(book, config, new FakeProvider([clean, '{"facts":[]}']), budget).review(draft.revisionId);
  }

  it('previews and applies two of three groups, then restores through new revisions', async () => {
    const before = new CommitService(book).exportText(); const source = await analyze();
    expect(patch.preview(source.proposal.id, ['g1', 'g2']).changes).toHaveLength(2);
    const selected = patch.select(source.proposal.id, ['g2', 'g1']);
    expect(patch.select(source.proposal.id, ['g1', 'g2']).id).toBe(selected.id);
    expect(new CommitService(book).exportText()).toBe(before);
    expect(() => approvals.approve(selected.id)).toThrow('审稿');
    await reviewSelection(selected.id); const accepted = approvals.approve(selected.id);
    const text = new CommitService(book).exportText();
    expect(text).toContain('远处的港口'); expect(text).toContain('航海日志'); expect(text).toContain('天亮后'); expect(text).not.toContain('三日后');
    expect(patch.proposals.get(source.proposal.id).status).toBe('stale');
    expect(() => patch.select(source.proposal.id, ['g3', 'g2'])).toThrow('重新分析');
    const restored = patch.undo(selected.id, accepted.version);
    expect(new CommitService(book).exportText()).toBe(before);
    expect(restored.version).toBe(accepted.version + 1);
    const originalFirst = book.snapshot(1).state.chapters[0]!;
    expect(restored.state.chapters[0]!.revisionId).not.toBe(originalFirst.revisionId);
  });

  it('requires complete dependencies and refuses overlapping or cyclic plans', async () => {
    const source = await analyze(); expect(() => patch.select(source.proposal.id, ['g3'])).toThrow('依赖不完整');
    const value = output(); value.groups[0]!.dependsOn = ['g2']; value.groups[1]!.dependsOn = ['g1'];
    const allowed = new Set(book.snapshot().state.chapters.map(chapter => chapter.revisionId));
    expect(() => normalizeImpact(book, value, allowed)).toThrow('循环');
    expect(() => normalizeImpact(book, { impacts: [], groups: [group(0, '码头', '港口'), { ...group(0, '码头', '海边'), id: 'alternative' }] }, allowed)).toThrow('重叠');
  });

  it('does not reuse full-selection review reports for a partial selection', async () => {
    const source = await analyze(); const all = patch.select(source.proposal.id, ['g1', 'g2', 'g3']); await reviewSelection(all.id);
    const partial = patch.select(source.proposal.id, ['g1']);
    expect(() => approvals.approve(partial.id)).toThrow('审稿');
    await reviewSelection(partial.id); approvals.approve(partial.id);
    expect(() => approvals.approve(all.id)).toThrow('版本冲突');
  });

  it('rejects facts copied from an unselected candidate', async () => {
    const source = await analyze(); const full = patch.select(source.proposal.id, ['g1', 'g2', 'g3']);
    const fullDraft = SelectionSchema.parse(full.payload).drafts[2]!;
    const partial = patch.select(source.proposal.id, ['g1']); const selected = SelectionSchema.parse(partial.payload).drafts[0]!;
    const leaked = JSON.stringify({ facts: [{ subject: '林舟', relation: 'event', value: '三日后进塔', kind: 'plan', characterId: null, storyTime: null, knowledgeTime: null, evidence: { chapterId: fullDraft.chapterId, revisionId: fullDraft.revisionId, blockId: 'b2', quote: '三日后' } }] });
    await expect(new CreationWorkflow(book, config, new FakeProvider([clean, leaked]), budget).review(selected.revisionId)).rejects.toThrow('引用来源不在');
    expect(() => approvals.approve(partial.id)).toThrow('事实提取结果');
    expect(new CommitService(book).exportText()).not.toContain('三日后');
  });

  it('preserves locked text and adjusts its anchor when preceding text changes', async () => {
    const first = book.snapshot().state.chapters[0]!;
    new CommitService(book).replace(first.id, '## 第一章\n林舟站在码头。\n\n这句话保持不变。\n', book.project().version);
    const lockId = patch.lock(first.id, 'b3'); const before = book.snapshot().state.locks[0]!;
    const source = await analyze({ impacts: [], groups: [group(0, '码头', '遥远的旧码头')] });
    const selected = patch.select(source.proposal.id, ['g1']); await reviewSelection(selected.id); approvals.approve(selected.id);
    const after = book.snapshot().state.locks.find(lock => lock.id === lockId)!;
    expect(after.quote).toBe(before.quote); expect(after.start).toBeGreaterThan(before.start);
    expect(book.revision(after.revisionId).content.slice(after.start, after.end)).toBe(before.quote);
    expect(() => new CommitService(book).replace(first.id, '替换全章。', book.project().version)).toThrow('锁定');
    patch.unlock(lockId);
  });

  it('rejects selected changes intersecting a locked range', async () => {
    const first = book.snapshot().state.chapters[0]!; patch.lock(first.id, 'b2');
    const source = await analyze();
    expect(() => patch.select(source.proposal.id, ['g1'])).toThrow('锁定范围');
  });

  it('does not approve a selection whose source analysis was cancelled', async () => {
    const source = await analyze(); const selected = patch.select(source.proposal.id, ['g1']); await reviewSelection(selected.id);
    new RunStore(book).cancel(source.runId);
    expect(() => approvals.approve(selected.id)).toThrow('已取消');
    expect(new CommitService(book).exportText()).not.toContain('远处的港口');
  });

  it('does not undo over later author edits and revalidates remaining work against the new baseline', async () => {
    const source = await analyze(); const selected = patch.select(source.proposal.id, ['g1', 'g2']); await reviewSelection(selected.id); approvals.approve(selected.id);
    const remaining = { impacts: [], groups: [group(2, '天亮后', '三日后')] };
    const newer = await new ImpactWorkflow(book, config, new FakeProvider([JSON.stringify(remaining)]), budget).revalidate(source.proposal.id);
    expect(newer.proposal.parentId).toBe(source.proposal.id); expect(newer.proposal.baseVersion).toBe(book.project().version);
    const first = book.snapshot().state.chapters[0]!; new CommitService(book).replace(first.id, '作者后续修改。', book.project().version);
    expect(() => patch.undo(selected.id, book.project().version)).toThrow('后续修改');
  });
});
