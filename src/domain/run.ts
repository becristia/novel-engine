import { z } from 'zod';

export const BudgetSchema = z.strictObject({ maxRequests: z.number().int().positive(), maxTokens: z.number().int().positive() });
export type Budget = z.infer<typeof BudgetSchema>;
