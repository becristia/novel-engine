import { readFileSync } from 'node:fs';
import { z } from 'zod';

const RecordSchema = z.strictObject({
  arm: z.enum(['baseline', 'workflow']), caseId: z.string().min(1), repetition: z.number().int().positive(),
  modelId: z.string().min(1), sourceHash: z.string().min(1), parametersHash: z.string().min(1),
  editingSeconds: z.number().positive(), elapsedSeconds: z.number().nonnegative(),
  truePositives: z.number().int().nonnegative(), falsePositives: z.number().int().nonnegative(), falseNegatives: z.number().int().nonnegative(),
  unapprovedLockedEdits: z.number().int().nonnegative(), estimatedCostUSD: z.number().nonnegative().nullable(),
});
export const EvaluationSchema = z.strictObject({
  protocolVersion: z.string().min(1), provenance: z.enum(['human', 'synthetic']), humanApproved: z.boolean(), protocolFrozen: z.boolean(), records: z.array(RecordSchema),
});
export function evaluationStatus() {
  const protocol = JSON.parse(readFileSync(new URL('../../fixtures/evaluation/protocol.json', import.meta.url), 'utf8')) as { status: string; version: string };
  const labels = JSON.parse(readFileSync(new URL('../../fixtures/evaluation/labels.draft.json', import.meta.url), 'utf8')) as { humanApproved: boolean };
  return { ready: protocol.status === 'frozen' && labels.humanApproved, protocolVersion: protocol.version, protocolStatus: protocol.status, humanLabelsApproved: labels.humanApproved, qualityPassed: false };
}

export function compareEvaluation(value: unknown) {
  const input = EvaluationSchema.parse(value); const reasons: string[] = [];
  const protocol = evaluationStatus();
  if (!protocol.ready || protocol.protocolVersion !== input.protocolVersion) reasons.push('项目参考标签未获人工确认，或评测协议尚未冻结／版本不匹配');
  const groups = { baseline: input.records.filter(record => record.arm === 'baseline'), workflow: input.records.filter(record => record.arm === 'workflow') };
  const keys = new Set<string>();
  for (const record of input.records) {
    const key = JSON.stringify([record.arm, record.caseId, record.repetition]);
    if (keys.has(key)) throw new Error('评测样本身份重复。'); keys.add(key);
    const other = input.records.find(item => item.arm !== record.arm && item.caseId === record.caseId && item.repetition === record.repetition);
    if (!other || other.modelId !== record.modelId || other.sourceHash !== record.sourceHash || other.parametersHash !== record.parametersHash) throw new Error('两组评测任务、模型、来源或参数不匹配。');
  }
  for (const arm of ['baseline', 'workflow'] as const) {
    for (const caseId of new Set(groups[arm].map(record => record.caseId))) {
      if (groups[arm].filter(record => record.caseId === caseId).length < 3) reasons.push(`${arm}:${caseId}:不足三次独立运行`);
    }
  }
  if (!input.records.length) reasons.push('缺少评测记录');
  if (input.provenance !== 'human' || !input.humanApproved || !input.protocolFrozen) reasons.push('缺少真实人工评测或冻结协议');
  if (input.records.some(record => record.estimatedCostUSD === null)) reasons.push('费用信息不完整');
  const summarize = (records: typeof input.records) => {
    const editing = records.map(record => record.editingSeconds).sort((left, right) => left - right);
    const middle = Math.floor(editing.length / 2);
    const median = editing.length ? (editing.length % 2 ? editing[middle]! : (editing[middle - 1]! + editing[middle]!) / 2) : null;
    const sum = (field: 'truePositives' | 'falseNegatives' | 'falsePositives' | 'unapprovedLockedEdits' | 'elapsedSeconds') => records.reduce((total, record) => total + record[field], 0);
    const positive = sum('truePositives'); const negative = sum('falseNegatives');
    return { medianEditingSeconds: median, recall: positive + negative ? positive / (positive + negative) : null, falsePositives: sum('falsePositives'), unapprovedLockedEdits: sum('unapprovedLockedEdits'), elapsedSeconds: sum('elapsedSeconds'), estimatedCostUSD: records.some(record => record.estimatedCostUSD === null) ? null : records.reduce((total, record) => total + record.estimatedCostUSD!, 0) };
  };
  const baseline = summarize(groups.baseline); const workflow = summarize(groups.workflow);
  const improvement = baseline.medianEditingSeconds && workflow.medianEditingSeconds ? 1 - workflow.medianEditingSeconds / baseline.medianEditingSeconds : null;
  if (improvement === null || improvement < 0.2) reasons.push('修稿时间降幅不足 20%');
  if (baseline.recall === null || workflow.recall === null || workflow.recall < baseline.recall) reasons.push('确定冲突召回未达到基线或样本不足');
  if (workflow.falsePositives > baseline.falsePositives) reasons.push('误报高于基线');
  if (workflow.unapprovedLockedEdits !== 0) reasons.push('发生未批准的锁定内容修改');
  return { protocolVersion: input.protocolVersion, provenance: input.provenance, passed: reasons.length === 0, reasons: [...new Set(reasons)], improvement, baseline, workflow };
}
