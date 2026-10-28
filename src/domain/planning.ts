import { z } from 'zod';

export const PlanContentSchema = z.strictObject({
  title: z.string().min(1), goal: z.string().min(1), characters: z.array(z.string()),
  constraints: z.array(z.string()), events: z.array(z.string()), targetLength: z.number().int().positive(),
});
export const PlannerOutputSchema = z.strictObject({ chapters: z.array(PlanContentSchema).min(1).max(20) });
export const ApprovedPlanSchema = PlanContentSchema.extend({ chapterId: z.string(), revisionId: z.string(), ordinal: z.number().int().positive() });
export type ApprovedPlan = z.infer<typeof ApprovedPlanSchema>;
export const PlanPayloadSchema = z.strictObject({ plans: z.array(ApprovedPlanSchema).min(1) });
export const DraftPayloadSchema = z.strictObject({ chapterId: z.string(), revisionId: z.string(), planRevisionId: z.string(), contentHash: z.string() });
