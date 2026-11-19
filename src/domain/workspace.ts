import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ApprovedPlanSchema } from './planning.js';
import { LockSchema } from './patch.js';
import { StoryStateSchema } from './story-memory.js';

export const ChapterRefSchema = z.strictObject({ id: z.string(), title: z.string(), revisionId: z.string() });
export const BookStateSchema = z.strictObject({
  chapters: z.array(ChapterRefSchema),
  constraints: z.array(z.string()),
  plans: z.record(z.string(), ApprovedPlanSchema).default({}),
  confirmedFactIds: z.array(z.string()).default([]),
  aliases: z.record(z.string(), z.array(z.string())).default({}),
  locks: z.array(LockSchema).default([]),
  story: StoryStateSchema.optional(),
});
export type BookState = z.infer<typeof BookStateSchema>;
export interface Snapshot { version: number; state: BookState }
export interface Revision {
  id: string; chapterId: string; parentId: string | null; content: string; contentHash: string; runId: string | null;
}
export function hash(text: string | Uint8Array): string {
  return createHash('sha256').update(text).digest('hex');
}
export function normalizeText(text: string): string { return text.replace(/\r\n?/gu, '\n'); }
export function positiveInteger(value: string): number {
  if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('参数必须是正整数。');
  return Number(value);
}
export function versionNumber(value: string): number {
  if (!/^(?:0|[1-9]\d*)$/u.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('版本必须是非负整数。');
  return Number(value);
}
