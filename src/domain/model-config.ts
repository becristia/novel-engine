import { z } from 'zod';

export const ModelConfigSchema = z.strictObject({
  provider: z.literal('fake'),
  modelId: z.literal('fake-v1'),
  maxOutputTokens: z.number().int().positive(),
});

export const AppConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  model: ModelConfigSchema,
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export function defaultConfig(): AppConfig {
  return {
    schemaVersion: 1,
    model: {
      provider: 'fake',
      modelId: 'fake-v1',
      maxOutputTokens: 1024,
    },
  };
}
