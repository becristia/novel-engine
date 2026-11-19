import { readFileSync } from 'node:fs';
import { z } from 'zod';

const Count = z.number().int().nonnegative();
const Measurement = z.strictObject({
  arm: z.enum(['local', 'hindsight']), caseId: z.string().min(1), split: z.enum(['development', 'holdout']), repetition: z.number().int().positive(),
  modelId: z.string().min(1), sourceHash: z.string().min(1), parametersHash: z.string().min(1), budgetPolicyHash: z.string().min(1), ruleVersion: z.literal('story-rules-v1'),
  expectedSources: z.array(z.string().min(1)), selectedSources: z.array(z.string().min(1)),
  quotesChecked: Count, invalidQuotes: Count, staleSourceUses: Count, crossBookSourceUses: Count, candidateSourceUses: Count, forbiddenInputs: Count, earlyReveals: Count, unapprovedLockedEdits: Count,
  editingSeconds: z.number().positive(), elapsedSeconds: z.number().nonnegative(), totalCostUSD: z.number().nonnegative().nullable(), completeCost: z.boolean(),
}).refine(record => record.invalidQuotes <= record.quotesChecked, '无效引用数不能大于检查引用数。');
export const StoryEvaluationSchema = z.strictObject({ protocolVersion: z.literal('story-memory-v1'), provenance: z.enum(['human', 'synthetic']), humanApproved: z.boolean(), records: z.array(Measurement) });

export function storyEvaluationStatus() {
  const protocol = JSON.parse(readFileSync(new URL('../../fixtures/story-memory/evaluation-protocol.json', import.meta.url), 'utf8')) as { version: string; status: string; humanApproved: boolean; thresholds: { minimumRecallGain: number; maximumEditingRatio: number } | null };
  return { protocolVersion: protocol.version, protocolStatus: protocol.status, humanLabelsApproved: protocol.humanApproved, thresholds: protocol.thresholds, ready: protocol.status === 'frozen' && protocol.humanApproved && protocol.thresholds !== null, qualityPassed: false };
}

export function compareStoryEvaluation(value: unknown) {
  const input = StoryEvaluationSchema.parse(value); const status = storyEvaluationStatus(); const reasons: string[] = [];
  if (!status.ready) reasons.push('人工标签、留出材料和效果阈值尚未冻结');
  if (input.provenance !== 'human' || !input.humanApproved) reasons.push('工程合成结果不能计为真实创作效果');
  const seen = new Set<string>();
  for (const record of input.records) {
    const key = JSON.stringify([record.arm, record.caseId, record.repetition]);
    if (seen.has(key) || new Set(record.expectedSources).size !== record.expectedSources.length || new Set(record.selectedSources).size !== record.selectedSources.length) throw new Error('评测样本或来源身份重复。');
    seen.add(key);
    const partner = input.records.find(other => other.arm !== record.arm && other.caseId === record.caseId && other.repetition === record.repetition);
    if (!partner || ['split', 'modelId', 'sourceHash', 'parametersHash', 'budgetPolicyHash', 'ruleVersion'].some(field => record[field as keyof typeof record] !== partner[field as keyof typeof partner]) || JSON.stringify([...record.expectedSources].sort()) !== JSON.stringify([...partner.expectedSources].sort())) throw new Error('两组记忆评测的材料、模型、规则、预算或参考来源不匹配。');
    if (!record.completeCost || record.totalCostUSD === null) reasons.push('未记录完整内部调用费用');
    if (record.invalidQuotes + record.staleSourceUses + record.crossBookSourceUses + record.candidateSourceUses + record.forbiddenInputs + record.unapprovedLockedEdits > 0) reasons.push('输入范围、引用或批准硬门槛未通过');
  }
  if (!input.records.length) reasons.push('缺少成对评测记录');
  for (const caseId of new Set(input.records.map(item => item.caseId))) if (input.records.filter(item => item.caseId === caseId && item.arm === 'local').length < 3) reasons.push('每组每任务需要至少 3 次独立运行');
  const summary = (arm: 'local' | 'hindsight') => {
    const records = input.records.filter(item => item.arm === arm && item.split === 'holdout');
    const matched = records.reduce((total, item) => total + item.selectedSources.filter(id => item.expectedSources.includes(id)).length, 0);
    const selected = records.reduce((total, item) => total + item.selectedSources.length, 0); const expected = records.reduce((total, item) => total + item.expectedSources.length, 0);
    const editing = records.map(item => item.editingSeconds).sort((a, b) => a - b); const middle = Math.floor(editing.length / 2);
    const quotes = records.reduce((total, item) => total + item.quotesChecked, 0);
    return { runs: records.length, recall: expected ? matched / expected : null, precision: selected ? matched / selected : null, medianEditingSeconds: editing.length ? editing.length % 2 ? editing[middle]! : (editing[middle - 1]! + editing[middle]!) / 2 : null,
      quoteValidity: quotes ? 1 - records.reduce((total, item) => total + item.invalidQuotes, 0) / quotes : null,
      earlyReveals: records.reduce((total, item) => total + item.earlyReveals, 0), elapsedSeconds: records.reduce((total, item) => total + item.elapsedSeconds, 0), totalCostUSD: records.every(item => item.completeCost && item.totalCostUSD !== null) && records.length ? records.reduce((total, item) => total + item.totalCostUSD!, 0) : null };
  };
  const local = summary('local'); const hindsight = summary('hindsight');
  if (!local.runs || !hindsight.runs) reasons.push('缺少独立留出集记录');
  if (status.thresholds) {
    if (local.recall === null || hindsight.recall === null || hindsight.recall - local.recall < status.thresholds.minimumRecallGain) reasons.push('来源召回收益未达到冻结阈值');
    if (local.medianEditingSeconds === null || hindsight.medianEditingSeconds === null || hindsight.medianEditingSeconds / local.medianEditingSeconds > status.thresholds.maximumEditingRatio) reasons.push('人工修稿时间未达到冻结阈值');
  }
  if (hindsight.earlyReveals > local.earlyReveals) reasons.push('正文提前揭示次数高于本地读取组');
  return { protocolVersion: input.protocolVersion, passed: reasons.length === 0, reasons: [...new Set(reasons)], local, hindsight };
}
