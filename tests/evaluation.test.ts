import { describe, expect, it } from 'vitest';
import { compareEvaluation, evaluationStatus } from '../src/application/evaluation.js';

function measurements() {
  const records = Array.from({ length: 3 }, (_, index) => ({
    caseId: 'synthetic-case', repetition: index + 1, modelId: 'fake-model', sourceHash: 'fixture', parametersHash: 'params',
    editingSeconds: 100, elapsedSeconds: 150, truePositives: 9, falsePositives: 1, falseNegatives: 1, unapprovedLockedEdits: 0, estimatedCostUSD: 0.1,
  }));
  return { protocolVersion: 'draft-v1', provenance: 'synthetic', humanApproved: false, protocolFrozen: false, records: [...records.map(record => ({ ...record, arm: 'baseline' })), ...records.map(record => ({ ...record, editingSeconds: 75, arm: 'workflow' }))] };
}

describe('effectiveness evaluation boundary', () => {
  it('does not declare the current unapproved reference set ready', () => {
    expect(evaluationStatus()).toMatchObject({ ready: false, humanLabelsApproved: false, qualityPassed: false });
  });
  it('computes paired metrics but refuses to certify synthetic data as human evidence', () => {
    const report = compareEvaluation(measurements());
    expect(report.improvement).toBe(0.25); expect(report.baseline.recall).toBe(0.9); expect(report.passed).toBe(false);
    expect(report.reasons).toContain('缺少真实人工评测或冻结协议');
  });
  it('rejects unmatched models and duplicate observations', () => {
    const mismatch = measurements(); mismatch.records[3]!.modelId = 'different-model';
    expect(() => compareEvaluation(mismatch)).toThrow('不匹配');
    const duplicate = measurements(); duplicate.records.push(duplicate.records[0]!);
    expect(() => compareEvaluation(duplicate)).toThrow('身份重复');
  });
  it('keeps quality and locked-content failures visible even when editing is faster', () => {
    const data = measurements(); data.records[3]!.unapprovedLockedEdits = 1; data.records[4]!.falsePositives = 10;
    const report = compareEvaluation(data); expect(report.reasons).toContain('发生未批准的锁定内容修改'); expect(report.reasons).toContain('误报高于基线');
  });
});
