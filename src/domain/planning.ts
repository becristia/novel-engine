import { z } from 'zod';

export const ScenePlanSchema = z.strictObject({
  id: z.string().min(1), title: z.string().min(1), goal: z.string().min(1), instructions: z.array(z.string().min(1)),
  narration: z.enum(['limited', 'omniscient', 'unreliable']), viewpointCharacter: z.string().nullable(), eventId: z.string().nullable(),
  revealClaimIds: z.array(z.string()), threadIds: z.array(z.string()),
}).refine(scene => scene.narration === 'omniscient' || scene.viewpointCharacter !== null, '有限或不可靠视角必须指定人物。');

export const PlanContentSchema = z.strictObject({
  title: z.string().min(1), goal: z.string().min(1), characters: z.array(z.string()),
  constraints: z.array(z.string()), events: z.array(z.string()), targetLength: z.number().int().positive(),
  viewpointCharacter: z.string().nullable().optional(),
  scenes: z.array(ScenePlanSchema).min(1).max(12).optional(),
});
export const PlannerOutputSchema = z.strictObject({ chapters: z.array(PlanContentSchema).min(1).max(20) });
export const StoryPlannerOutputSchema = z.strictObject({ chapters: z.array(PlanContentSchema.extend({ scenes: z.array(ScenePlanSchema).min(1).max(12) })).min(1).max(20) });
export const ApprovedPlanSchema = PlanContentSchema.extend({ chapterId: z.string(), revisionId: z.string(), ordinal: z.number().int().positive() });
export type ApprovedPlan = z.infer<typeof ApprovedPlanSchema>;
export const PlanPayloadSchema = z.strictObject({ plans: z.array(ApprovedPlanSchema).min(1) });
export const DraftPayloadSchema = z.strictObject({ chapterId: z.string(), revisionId: z.string(), planRevisionId: z.string(), contentHash: z.string(), sceneRanges: z.array(z.strictObject({ sceneId: z.string(), start: z.number().int().nonnegative(), end: z.number().int().positive() })).optional() });
