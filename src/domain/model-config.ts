import { z } from 'zod';

const common = {
  maxOutputTokens: z.number().int().positive(),
  contextWindowTokens: z.number().int().positive().default(16384),
  timeoutMs: z.number().int().min(1).max(2147483647).default(30000),
  prices: z.strictObject({ inputPerMillion: z.number().nonnegative(), outputPerMillion: z.number().nonnegative(), version: z.string().min(1) }).optional(),
};
const FakeConfigSchema = z.strictObject({
  ...common,
  provider: z.literal('fake'),
  modelId: z.literal('fake-v1'),
  responsesFile: z.string().min(1).optional(),
});
const CompatibleConfigSchema = z.strictObject({
  ...common,
  provider: z.literal('openai-compatible'),
  modelId: z.string().min(1),
  baseURL: z.url().refine(value => new URL(value).protocol === 'https:', 'HTTPS required'),
  apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
});
export const ModelConfigSchema = z.discriminatedUnion('provider', [FakeConfigSchema, CompatibleConfigSchema]);

export const AppConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  model: ModelConfigSchema,
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export function defaultConfig(): AppConfig {
  return AppConfigSchema.parse({
    schemaVersion: 1,
    model: {
      provider: 'fake',
      modelId: 'fake-v1',
      maxOutputTokens: 1024,
    },
  });
}
