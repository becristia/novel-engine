import { randomUUID } from 'node:crypto';
import { PatchPayloadSchema, SelectionSchema, ImpactSchema } from '../domain/patch.js';
import type { PatchPayload, TextEdit } from '../domain/patch.js';
import type { BookState } from '../domain/workspace.js';
import { hash } from '../domain/workspace.js';
import { resolveReference, validateReview, validateExtraction, blocks } from '../review/evidence.js';
import { BookStore } from '../storage/book-store.js';
import { ProposalStore } from '../storage/proposal-store.js';
import type { Proposal } from '../storage/proposal-store.js';
import { RunStore } from '../storage/run-store.js';
import { ReviewStore } from '../storage/review-store.js';

export function normalizeImpact(book: BookStore, raw: unknown, allowed: ReadonlySet<string>) {
  const output = ImpactSchema.parse(raw);
  const ids = new Set(output.groups.map(group => group.id));
  if (ids.size !== output.groups.length) throw new Error('修改组 ID 重复。');
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('修改组依赖存在循环。');
    if (visited.has(id)) return;
    visiting.add(id);
    const group = output.groups.find(item => item.id === id);
    if (!group) throw new Error('修改组依赖不存在。');
    for (const dependency of group.dependsOn) visit(dependency);
    visiting.delete(id); visited.add(id);
  };
  for (const id of ids) visit(id);
  const groups = output.groups.map(group => ({ ...group, changes: group.changes.map(change => ({ ...change, target: resolveReference(book, change.target, allowed) })) }));
  const all = groups.flatMap(group => group.changes);
  for (let index = 0; index < all.length; index += 1) for (const other of all.slice(index + 1)) {
    const current = all[index]!.target;
    if (current.revisionId === other.target.revisionId && current.start! < other.target.end! && other.target.start! < current.end!) throw new Error('修改组存在重叠范围，请重新规划互不重叠的修改。');
  }
  return { impacts: output.impacts.map(impact => {
    if (![...allowed].some(id => book.revision(id).chapterId === impact.chapterId)) throw new Error('影响判断超出已检查章节范围。');
    if (!impact.evidence.some(reference => reference.chapterId === impact.chapterId)) throw new Error('影响判断缺少目标章节的原文证据。');
    return { ...impact, evidence: impact.evidence.map(reference => resolveReference(book, reference, allowed)) };
  }), groups };
}

export function transformedContent(content: string, edits: TextEdit[]): string {
  let result = content;
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  return result;
}

function assertUnlocked(state: BookState, chapterId: string, edits: TextEdit[]): void {
  for (const lock of state.locks.filter(item => item.chapterId === chapterId)) {
    if (edits.some(edit => edit.start < lock.end && edit.end > lock.start)) throw new Error('修改触碰锁定范围。');
  }
}

export function previewGroups(book: BookStore, payload: PatchPayload, groupIds: string[], state: BookState) {
  if (!groupIds.length || new Set(groupIds).size !== groupIds.length) throw new Error('选择的修改组不能为空或重复。');
  const groups = groupIds.map(id => {
    const group = payload.groups.find(item => item.id === id);
    if (!group) throw new Error('修改组不存在。');
    if (group.dependsOn.some(id => !groupIds.includes(id))) throw new Error('所选修改组的依赖不完整。');
    return group;
  });
  const results = new Map<string, { chapterId: string; baseRevisionId: string; before: string; after: string; edits: TextEdit[] }>();
  for (const change of groups.flatMap(group => group.changes)) {
    const chapter = state.chapters.find(item => item.id === change.target.chapterId);
    if (!chapter || chapter.revisionId !== change.target.revisionId) throw new Error('修改来源版本已过期。');
    const reference = resolveReference(book, change.target, new Set([chapter.revisionId]));
    const before = book.revision(chapter.revisionId).content;
    const result = results.get(chapter.id) ?? { chapterId: chapter.id, baseRevisionId: chapter.revisionId, before, after: '', edits: [] };
    result.edits.push({ start: reference.start!, end: reference.end!, replacement: change.replacement }); results.set(chapter.id, result);
  }
  for (const item of results.values()) {
    assertUnlocked(state, item.chapterId, item.edits);
    item.after = transformedContent(item.before, item.edits);
    if (!item.after.trim() || !blocks(item.after).some(block => !block.text.startsWith('## '))) throw new Error('局部修改不能清空整章正文。');
  }
  return [...results.values()];
}

export function moveLocks(book: BookStore, state: BookState, chapterId: string, revisionId: string, edits: TextEdit[]): void {
  assertUnlocked(state, chapterId, edits);
  const revision = book.revision(revisionId);
  for (const lock of state.locks.filter(item => item.chapterId === chapterId)) {
    const displacement = edits.filter(edit => edit.end <= lock.start).reduce((sum, edit) => sum + edit.replacement.length - (edit.end - edit.start), 0);
    lock.start += displacement; lock.end += displacement; lock.revisionId = revisionId; lock.contentHash = revision.contentHash;
  }
}

export function acceptSelection(book: BookStore, proposal: Proposal, state: BookState, reason: string) {
  const selected = SelectionSchema.parse(proposal.payload); const proposals = new ProposalStore(book);
  const source = proposals.get(selected.sourceProposalId); const payload = PatchPayloadSchema.parse(source.payload);
  new RunStore(book).assertRunnable(source.runId);
  if (source.status !== 'pending' || source.baseVersion !== proposal.baseVersion) throw new Error('原修改提案已过期，需要重新分析。');
  const expected = previewGroups(book, payload, selected.groupIds, state);
  if (expected.length !== selected.drafts.length) throw new Error('候选集合与所选修改组不一致。');
  const formedSources = new Set(state.chapters.map(chapter => selected.drafts.find(draft => draft.chapterId === chapter.id)?.revisionId ?? chapter.revisionId));
  const reviewIds: string[] = [];
  for (const draft of selected.drafts) {
    const calculated = expected.find(item => item.chapterId === draft.chapterId); const revision = book.revision(draft.revisionId);
    if (!calculated || calculated.baseRevisionId !== draft.baseRevisionId || revision.parentId !== draft.baseRevisionId || revision.chapterId !== draft.chapterId || hash(calculated.after) !== draft.contentHash || revision.contentHash !== draft.contentHash) throw new Error('部分采纳候选与实际选择内容不一致。');
    const reports = new ReviewStore(book).approvedReports(revision.id, proposal.baseVersion);
    validateReview(book, reports.review, formedSources); validateExtraction(book, reports.extraction, revision.id);
    if (reports.review.issues.some(issue => issue.kind === 'conflict')) throw new Error('部分结果仍有确定冲突，不能批准。');
    if (reports.review.issues.length && !reason.trim()) throw new Error('需要用 --reason 记录作者处理意见。');
    reviewIds.push(reports.reviewId);
    state.chapters.find(chapter => chapter.id === draft.chapterId)!.revisionId = revision.id;
    moveLocks(book, state, draft.chapterId, revision.id, calculated.edits);
  }
  proposals.status(source.id, 'stale');
  return { sourceProposalId: source.id, groupIds: selected.groupIds, revisionIds: selected.drafts.map(draft => draft.revisionId), reviewIds };
}

export class PatchService {
  readonly proposals: ProposalStore;
  constructor(readonly book: BookStore) { this.proposals = new ProposalStore(book); }

  preview(id: string, groupIds?: string[]) {
    const proposal = this.proposals.get(id); if (proposal.kind !== 'patch') throw new Error('该提案不是局部修改提案。');
    const payload = PatchPayloadSchema.parse(proposal.payload);
    return { stale: proposal.baseVersion !== this.book.project().version, changes: payload.groups.length ? previewGroups(this.book, payload, groupIds ?? payload.groups.map(group => group.id), this.book.snapshot(proposal.baseVersion).state) : [] };
  }

  select(id: string, groupIds: string[]): Proposal {
    return this.book.db.transaction(() => {
      const source = this.proposals.get(id);
      if (source.kind !== 'patch') throw new Error('只能选择局部修改提案中的修改组。');
      const key = hash(JSON.stringify([id, [...groupIds].sort()]));
      const previous = this.book.db.prepare('SELECT proposal_id FROM selection_keys WHERE request_id = ?').get(key) as { proposal_id: string } | undefined;
      if (previous) return this.proposals.get(previous.proposal_id);
      if (source.status !== 'pending' || source.baseVersion !== this.book.project().version) throw new Error('旧提案需要重新分析与校验。');
      const runs = new RunStore(this.book); const sourceRun = runs.assertRunnable(source.runId);
      const expected = previewGroups(this.book, PatchPayloadSchema.parse(source.payload), groupIds, this.book.snapshot().state);
      const run = runs.create('selection', { sourceProposalId: id, groupIds }, sourceRun.config, sourceRun.budget);
      const drafts = expected.map(item => {
        const revision = this.book.insertRevision(item.chapterId, item.after, item.baseRevisionId, run.id);
        return { chapterId: item.chapterId, revisionId: revision.id, baseRevisionId: item.baseRevisionId, contentHash: revision.contentHash };
      });
      const result = this.proposals.create('selection', source.baseVersion, { sourceProposalId: id, groupIds: [...groupIds].sort(), drafts }, run.id, id);
      this.book.db.prepare('INSERT INTO selection_keys VALUES (?, ?)').run(key, result.id); runs.status(run.id, 'awaiting_approval');
      return result;
    }).immediate();
  }

  undo(id: string, expectedVersion: number) {
    const proposal = this.proposals.get(id);
    if (proposal.kind !== 'selection' || proposal.status !== 'approved') throw new Error('只能撤回已批准的局部修改。');
    const selected = SelectionSchema.parse(proposal.payload); const source = PatchPayloadSchema.parse(this.proposals.get(selected.sourceProposalId).payload);
    return this.book.commit(expectedVersion, `undo:${id}`, hash(JSON.stringify({ id, expectedVersion })), state => {
      const originals = previewGroups(this.book, source, selected.groupIds, this.book.snapshot(proposal.baseVersion).state);
      for (const draft of selected.drafts) {
        const chapter = state.chapters.find(item => item.id === draft.chapterId);
        if (!chapter || chapter.revisionId !== draft.revisionId) throw new Error('章节已有后续修改，不能自动撤回覆盖。');
        const original = originals.find(item => item.chapterId === draft.chapterId)!;
        let displacement = 0;
        const reverse = [...original.edits].sort((left, right) => left.start - right.start).map(edit => {
          const start = edit.start + displacement; displacement += edit.replacement.length - (edit.end - edit.start);
          return { start, end: start + edit.replacement.length, replacement: original.before.slice(edit.start, edit.end) };
        });
        assertUnlocked(state, chapter.id, reverse);
        const restored = this.book.insertRevision(chapter.id, original.before, chapter.revisionId);
        chapter.revisionId = restored.id; moveLocks(this.book, state, chapter.id, restored.id, reverse);
      }
    });
  }

  lock(chapterId: string, blockId: string): string {
    const id = randomUUID();
    this.book.commit(this.book.project().version, randomUUID(), hash(JSON.stringify({ chapterId, blockId })), state => {
      const chapter = state.chapters.find(item => item.id === chapterId); if (!chapter) throw new Error('正式章节不存在。');
      const revision = this.book.revision(chapter.revisionId); const block = blocks(revision.content).find(item => item.id === blockId);
      if (!block) throw new Error('区块不存在。');
      if (state.locks.some(item => item.chapterId === chapterId && item.start === block.start && item.end === block.end)) throw new Error('该区块已经锁定。');
      state.locks.push({ id, chapterId, revisionId: revision.id, contentHash: revision.contentHash, start: block.start, end: block.end, quote: block.text });
    }); return id;
  }

  unlock(id: string): void {
    this.book.commit(this.book.project().version, randomUUID(), hash(id), state => {
      if (!state.locks.some(item => item.id === id)) throw new Error('锁定记录不存在。');
      state.locks = state.locks.filter(item => item.id !== id);
    });
  }
}
