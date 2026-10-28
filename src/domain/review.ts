import { z } from 'zod';

export const ReferenceSchema = z.strictObject({
  chapterId: z.string(), revisionId: z.string(), blockId: z.string(), quote: z.string().min(1),
  start: z.number().int().nonnegative().optional(), end: z.number().int().positive().optional(), contentHash: z.string().optional(),
});
export type Reference = z.infer<typeof ReferenceSchema>;
export const ReviewSchema = z.strictObject({
  summary: z.string(),
  issues: z.array(z.strictObject({
    id: z.string().min(1), kind: z.enum(['conflict', 'uncertain', 'style']), message: z.string().min(1),
    evidence: z.array(ReferenceSchema).min(1), suggestion: z.string(),
  })),
});
export type Review = z.infer<typeof ReviewSchema>;
export const FactSchema = z.strictObject({
  subject: z.string().min(1), relation: z.enum(['location', 'possession', 'identity', 'knowledge', 'event', 'foreshadow']), value: z.string().min(1),
  kind: z.enum(['fact', 'belief', 'plan']), characterId: z.string().nullable(), storyTime: z.string().nullable(), knowledgeTime: z.string().nullable(),
  evidence: ReferenceSchema,
});
export const ExtractionSchema = z.strictObject({ facts: z.array(FactSchema) });
export type Extraction = z.infer<typeof ExtractionSchema>;
