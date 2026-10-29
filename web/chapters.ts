import type { WorkspaceView } from './model.js';
import { DraftPayloadSchema } from '../src/domain/planning.js';
import { SelectionSchema } from '../src/domain/patch.js';

export function chapterCatalog(data: WorkspaceView) {
  const plans = Object.values(data.snapshot.state.plans).sort((a, b) => a.ordinal - b.ordinal);
  const formal = data.snapshot.state.chapters;
  return [...formal.map((chapter, index) => ({ ...chapter, ordinal: index + 1, plan: data.snapshot.state.plans[chapter.id] ?? null })), ...plans.filter(plan => !formal.some(chapter => chapter.id === plan.chapterId)).map(plan => ({ id: plan.chapterId, title: plan.title, revisionId: null, ordinal: plan.ordinal, plan }))];
}
export function chapterCandidates(data: WorkspaceView, chapterId: string) {
  return data.proposals.flatMap(proposal => {
    if (proposal.kind === 'draft') { const draft = DraftPayloadSchema.parse(proposal.payload); return draft.chapterId === chapterId ? [{ proposal, revisionId: draft.revisionId }] : []; }
    if (proposal.kind === 'selection') { const draft = SelectionSchema.parse(proposal.payload).drafts.find(item => item.chapterId === chapterId); return draft ? [{ proposal, revisionId: draft.revisionId }] : []; }
    return [];
  });
}
export function chapterStatus(data: WorkspaceView, id: string) {
  const candidate = chapterCandidates(data, id).findLast(item => item.proposal.status === 'pending' && !item.proposal.stale);
  if (candidate) return candidate.proposal.approval.blockedCode === 'conflict' ? '待修订' : candidate.proposal.approval.canApprove ? '待批准' : '有候选';
  return data.snapshot.state.chapters.some(chapter => chapter.id === id) ? '正式稿' : '待生成';
}
