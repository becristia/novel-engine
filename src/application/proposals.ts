import { randomUUID } from 'node:crypto';
import { PlanContentSchema, PlanPayloadSchema } from '../domain/planning.js';
import { hash } from '../domain/workspace.js';
import { BookStore } from '../storage/book-store.js';
import { ProposalStore } from '../storage/proposal-store.js';
import { RunStore } from '../storage/run-store.js';

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
      if (current.kind !== 'plan') throw new Error('正文候选必须完成绑定版本的检查与审稿后才能批准。');
      const payload = PlanPayloadSchema.parse(current.payload);
      for (const plan of payload.plans) state.plans[plan.chapterId] = plan;
      this.proposals.status(id, 'approved');
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
