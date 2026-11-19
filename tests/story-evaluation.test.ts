import { describe, expect, it } from 'vitest';
import { compareStoryEvaluation, storyEvaluationStatus } from '../src/application/story-evaluation.js';
import type { z } from 'zod';
import type { StoryEvaluationSchema } from '../src/application/story-evaluation.js';

const measurements = (): z.infer<typeof StoryEvaluationSchema> => ({ protocolVersion: 'story-memory-v1', provenance: 'synthetic', humanApproved: false,
  records: (['local', 'hindsight'] as const).flatMap(arm => [1, 2, 3].map(repetition => ({ arm, caseId: 'snow-letter', split: 'holdout' as const, repetition, modelId: 'same-model', sourceHash: 'same-material', parametersHash: 'same-options', budgetPolicyHash: 'same-budget', ruleVersion: 'story-rules-v1' as const, expectedSources: ['H01', 'H02'], selectedSources: arm === 'local' ? ['H01'] : ['H01', 'H02'], quotesChecked: 3, invalidQuotes: 0, staleSourceUses: 0, crossBookSourceUses: 0, candidateSourceUses: 0, forbiddenInputs: 0, earlyReveals: 0, unapprovedLockedEdits: 0, editingSeconds: arm === 'local' ? 100 : 70, elapsedSeconds: 10, totalCostUSD: 0.01, completeCost: true }))) });
describe('separate story retrieval and author quality measurement', () => {
  it('computes paired recall but refuses synthetic evidence and unfrozen labels', () => {
    const result = compareStoryEvaluation(measurements()); expect(result.local.recall).toBe(0.5); expect(result.hindsight.recall).toBe(1); expect(result.passed).toBe(false);
    expect(storyEvaluationStatus()).toMatchObject({ ready: false, qualityPassed: false });
  });
  it('rejects mismatched budget policies, repeated identities and incomparable reference sets', () => {
    const data = measurements(); data.records[0]!.budgetPolicyHash = 'different'; expect(() => compareStoryEvaluation(data)).toThrow('不匹配');
    const duplicate = measurements(); duplicate.records.push(duplicate.records[0]!); expect(() => compareStoryEvaluation(duplicate)).toThrow('重复');
    const labels = measurements(); labels.records[0]!.expectedSources = ['other']; expect(() => compareStoryEvaluation(labels)).toThrow('参考来源');
  });
  it('keeps input violations, semantic early reveals and missing internal costs separate', () => {
    const data = measurements(); const record = data.records.at(-1)!; record.forbiddenInputs = 1; record.earlyReveals = 1; record.completeCost = false;
    const result = compareStoryEvaluation(data); expect(result.hindsight.totalCostUSD).toBeNull(); expect(result.reasons).toEqual(expect.arrayContaining(['未记录完整内部调用费用', '输入范围、引用或批准硬门槛未通过', '正文提前揭示次数高于本地读取组']));
  });
  it('requires three paired runs and an independent holdout', () => {
    const data = measurements(); data.records = data.records.filter(record => record.repetition === 1).map(record => ({ ...record, split: 'development' }));
    expect(compareStoryEvaluation(data).reasons).toEqual(expect.arrayContaining(['每组每任务需要至少 3 次独立运行', '缺少独立留出集记录']));
  });
});
