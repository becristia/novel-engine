import { randomUUID } from 'node:crypto';
import { PlanContentSchema, PlanPayloadSchema, DraftPayloadSchema } from '../domain/planning.js';
import { hash } from '../domain/workspace.js';
import { BookStore } from '../storage/book-store.js';
import { ProposalStore } from '../storage/proposal-store.js';
import { RunStore } from '../storage/run-store.js';
import { ReviewStore } from '../storage/review-store.js';
import { validateReview, validateExtraction } from '../review/evidence.js';

export class ProposalService {
  readonly proposals: ProposalStore;
  constructor(readonly book: BookStore) { this.proposals = new ProposalStore(book); }

  approve(id: string, reason = '') {
    const proposal = this.proposals.get(id);
    const { status: _status, ...immutable } = proposal;
    const fingerprint = hash(JSON.stringify({ proposal: immutable, reason }));
    const requestId = `approve:${id}:${hash(reason)}`;
    return this.book.commit(proposal.baseVersion, requestId, fingerprint, state => {
      const current = this.proposals.get(id);
      if (current.status !== 'pending') throw new Error('提案当前不能批准。');
      new RunStore(this.book).assertRunnable(current.runId);
      let approvedRevision: string | null = null;
      let approvedReview: string | null = null;
      if (current.kind === 'plan') {
        const payload = PlanPayloadSchema.parse(current.payload);
        for (const plan of payload.plans) state.plans[plan.chapterId] = plan;
      } else if (current.kind === 'draft') {
        const payload = DraftPayloadSchema.parse(current.payload);
        const revision = this.book.revision(payload.revisionId);
        const plan = state.plans[payload.chapterId];
        if (!plan || plan.revisionId !== payload.planRevisionId || revision.chapterId !== payload.chapterId || revision.contentHash !== payload.contentHash) throw new Error('候选正文、计划或内容哈希不匹配。');
        const reports = new ReviewStore(this.book).approvedReports(revision.id, current.baseVersion);
        const allowed = new Set([...state.chapters.map(chapter => chapter.revisionId), revision.id]);
        validateReview(this.book, reports.review, allowed); validateExtraction(this.book, reports.extraction, revision.id);
        if (reports.review.issues.some(issue => issue.kind === 'conflict')) throw new Error('存在尚未解决的确定冲突，请修订并重新审稿。');
        if (reports.review.issues.length && !reason.trim()) throw new Error('存在待核查或风格意见，请用 --reason 记录作者处理理由。');
        const existing = state.chapters.find(chapter => chapter.id === payload.chapterId);
        if (existing) existing.revisionId = revision.id;
        else state.chapters.push({ id: payload.chapterId, title: plan.title, revisionId: revision.id });
        approvedRevision = revision.id; approvedReview = reports.reviewId;
      } else throw new Error('该提案类型需要先形成可审稿的候选。');
      this.proposals.status(id, 'approved');
      this.book.db.prepare('INSERT INTO approvals VALUES (?, ?, ?, ?, ?, ?)').run(requestId, id, approvedRevision, approvedReview, reason, new Date().toISOString());
      new RunStore(this.book).status(current.runId, 'succeeded');
    });
  }

  editPlan(id: string, ordinal: number, value: unknown) {
    const content = PlanContentSchema.parse(value);
    return this.book.db.transaction(() => {
      const proposal = this.proposals.get(id);
      if (proposal.kind !== 'plan' || proposal.status !== 'pending') throw new Error('只能修改待批准的计划提案。');
      new RunStore(this.book).assertRunnable(proposal.runId);
      const payload = PlanPayloadSchema.parse(proposal.payload);
      const plan = payload.plans.find(item => item.ordinal === ordinal);
      if (!plan) throw new Error('提案中不存在该章计划。');
      Object.assign(plan, content, { revisionId: randomUUID() });
      this.proposals.status(id, 'superseded');
      return this.proposals.create('plan', proposal.baseVersion, payload, proposal.runId, id);
    }).immediate();
  }

  reject(id: string): void {
    const proposal = this.proposals.get(id);
    if (proposal.status !== 'pending') throw new Error('只能拒绝待处理提案。');
    this.proposals.status(id, 'rejected');
  }
}
