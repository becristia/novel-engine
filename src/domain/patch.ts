import { z } from 'zod';
import { ReferenceSchema } from './review.js';

const ChangeSchema = z.strictObject({ target: ReferenceSchema, replacement: z.string() });
const GroupSchema = z.strictObject({ id: z.string().min(1), reason: z.string().min(1), dependsOn: z.array(z.string()), changes: z.array(ChangeSchema).min(1) });
export const ImpactSchema = z.strictObject({
  impacts: z.array(z.strictObject({ chapterId: z.string(), kind: z.enum(['direct-conflict', 'causal-check']), explanation: z.string().min(1), evidence: z.array(ReferenceSchema).min(1) })),
  groups: z.array(GroupSchema),
});
export const PatchPayloadSchema = ImpactSchema.extend({ instruction: z.string(), sourceChapterId: z.string(), searchedChapterIds: z.array(z.string()), omittedChapterIds: z.array(z.string()) });
export type PatchPayload = z.infer<typeof PatchPayloadSchema>;
export const SelectionSchema = z.strictObject({
  sourceProposalId: z.string(), groupIds: z.array(z.string()).min(1),
  drafts: z.array(z.strictObject({ chapterId: z.string(), revisionId: z.string(), baseRevisionId: z.string(), contentHash: z.string() })).min(1),
});
export type Selection = z.infer<typeof SelectionSchema>;
export const LockSchema = z.strictObject({ id: z.string(), chapterId: z.string(), revisionId: z.string(), contentHash: z.string(), start: z.number().int().nonnegative(), end: z.number().int().positive(), quote: z.string().min(1) });
export type TextEdit = { start: number; end: number; replacement: string };
