import { z } from 'zod';
import { PlanContentSchema } from './planning.js';
import { FactSchema } from './review.js';
import { BudgetSchema } from './run.js';

const id = z.string().min(1).max(256);
const version = z.number().int().nonnegative();
const expected = { expectedVersion: version };
export const ActionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('approve'), ...expected, proposalId: id, reason: z.string().max(10000).default('') }),
  z.strictObject({ action: z.literal('reject'), ...expected, proposalId: id }),
  z.strictObject({ action: z.literal('edit-plan'), ...expected, proposalId: id, chapter: z.number().int().positive(), plan: PlanContentSchema }),
  z.strictObject({ action: z.literal('replace'), ...expected, chapterId: id, content: z.string().min(1).max(2000000), requestId: z.string().uuid() }),
  z.strictObject({ action: z.literal('insert'), ...expected, title: z.string().min(1).max(200), content: z.string().min(1).max(2000000), position: z.number().int().positive() }),
  z.strictObject({ action: z.literal('reorder'), ...expected, chapterIds: z.array(id).min(1) }),
  z.strictObject({ action: z.literal('confirm-facts'), ...expected, ids: z.array(id).min(1).max(500) }),
  z.strictObject({ action: z.literal('correct-fact'), ...expected, id, fact: FactSchema }),
  z.strictObject({ action: z.literal('aliases'), ...expected, entity: id, names: z.array(z.string().trim().min(1).max(100)).min(1).max(50) }),
  z.strictObject({ action: z.literal('constraints'), ...expected, values: z.array(z.string().min(1).max(10000)).max(200) }),
  z.strictObject({ action: z.literal('select-patch'), ...expected, proposalId: id, groups: z.array(id).min(1) }),
  z.strictObject({ action: z.literal('lock'), ...expected, chapterId: id, blockId: id }),
  z.strictObject({ action: z.literal('unlock'), ...expected, id }),
  z.strictObject({ action: z.literal('undo'), ...expected, proposalId: id }),
  z.strictObject({ action: z.literal('restore'), ...expected, chapterId: id, revisionId: id }),
  z.strictObject({ action: z.literal('cancel'), runId: id }),
]);
export type WorkbenchAction = z.infer<typeof ActionSchema>;

const common = { ...expected, requestId: z.string().uuid(), budget: BudgetSchema };
export const JobSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('plan'), ...common, brief: z.string().trim().min(1).max(50000), chapters: z.number().int().min(1).max(20) }),
  z.strictObject({ kind: z.enum(['write', 'draft']), ...common, chapter: z.number().int().positive(), reviseOnce: z.boolean().default(false) }),
  z.strictObject({ kind: z.literal('review'), ...common, revisionId: id }),
  z.strictObject({ kind: z.literal('revise'), ...common, revisionId: id, instruction: z.string().trim().min(1).max(20000) }),
  z.strictObject({ kind: z.literal('impact'), ...common, chapterId: id, instruction: z.string().trim().min(1).max(20000) }),
  z.strictObject({ kind: z.literal('revalidate'), ...common, proposalId: id }),
  z.strictObject({ kind: z.literal('memory'), ...common, chapterId: id.optional() }),
  z.strictObject({ kind: z.literal('probe'), ...common }),
  z.strictObject({ kind: z.literal('resume'), ...common, runId: id, retryUnknown: z.boolean().default(false) }),
]);
export type WorkbenchJob = z.infer<typeof JobSchema>;
