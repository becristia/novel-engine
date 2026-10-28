import type { AppConfig } from '../domain/model-config.js';
import { BookStore } from '../storage/book-store.js';
import { z } from 'zod';
import { ApprovedPlanSchema } from '../domain/planning.js';
import { MemoryStore } from '../storage/memory-store.js';
import { relevantFacts, memoryGroups } from './memory.js';

export const ContextSchema = z.strictObject({
  projectVersion: z.number().int().nonnegative(), plan: ApprovedPlanSchema,
  sources: z.array(z.strictObject({ kind: z.enum(['constraint', 'plan', 'chapter', 'fact', 'summary']), id: z.string(), revisionId: z.string(), text: z.string(), reason: z.string(), estimatedTokens: z.number().int().nonnegative() })),
  estimatedTokens: z.number().int().nonnegative(),
  omissions: z.array(z.strictObject({ id: z.string(), reason: z.string() })).optional(),
  memory: z.strictObject({ facts: z.array(z.string()), beliefs: z.array(z.string()), futurePlans: z.array(z.string()), knownByViewpoint: z.array(z.string()), knowledgeBoundary: z.string(), singleValueConflicts: z.array(z.array(z.string())), timePolicy: z.string() }).optional(),
});
export type ContextSnapshot = z.infer<typeof ContextSchema>;

export interface ContextSource { kind: 'constraint' | 'plan' | 'chapter' | 'fact' | 'summary'; id: string; revisionId: string; text: string; reason: string; estimatedTokens: number }
export function buildContext(book: BookStore, chapter: number | string, config: AppConfig, version = book.project().version) {
  const snapshot = book.snapshot(version);
  const plan = Object.values(snapshot.state.plans).find(item => typeof chapter === 'number' ? item.ordinal === chapter : item.chapterId === chapter);
  if (!plan) throw new Error('本章没有已批准计划。');
  const previousPlans = Object.values(snapshot.state.plans).filter(item => item.ordinal < plan.ordinal);
  if (previousPlans.some(item => !snapshot.state.chapters.some(existing => existing.id === item.chapterId))) throw new Error('前序章节尚未接受，不能越过正式稿继续生成。');
  const source = (kind: ContextSource['kind'], id: string, revisionId: string, text: string, reason: string): ContextSource => ({ kind, id, revisionId, text, reason, estimatedTokens: Buffer.byteLength(text, 'utf8') });
  const sources: ContextSource[] = [
    source('constraint', 'author', String(version), JSON.stringify(snapshot.state.constraints), '作者硬约束'),
    source('plan', plan.chapterId, plan.revisionId, JSON.stringify(plan), '已批准的本章目标；不是已发生事实'),
  ];
  const limit = config.model.contextWindowTokens - config.model.maxOutputTokens - 2048;
  let estimatedTokens = sources.reduce((sum, item) => sum + item.estimatedTokens, 0);
  if (estimatedTokens > limit) throw new Error('上下文超出预算，未静默截断作者约束或正文。');
  const memory = new MemoryStore(book);
  const targetIndex = snapshot.state.chapters.findIndex(item => item.id === plan.chapterId);
  const prior = snapshot.state.chapters.filter((item, index) => targetIndex >= 0 ? index < targetIndex : (snapshot.state.plans[item.id]?.ordinal ?? 0) < plan.ordinal);
  const allowedRevisions = new Set(prior.map(item => item.revisionId));
  const facts = relevantFacts(memory, snapshot.state, plan, allowedRevisions);
  const selectedFacts: typeof facts = []; const omissions: { id: string; reason: string }[] = [];
  const add = (item: ContextSource): boolean => {
    if (estimatedTokens + item.estimatedTokens > limit) { omissions.push({ id: item.id, reason: 'budget' }); return false; }
    sources.push(item); estimatedTokens += item.estimatedTokens; return true;
  };
  const recent = prior.slice(-2);
  for (const item of recent) {
    const raw = book.revision(item.revisionId).content;
    if (add(source('chapter', item.id, item.revisionId, raw, '最近正式正文'))) continue;
    const summary = memory.summary(item.revisionId);
    if (!summary || !add(source('summary', item.id, item.revisionId, summary, '新鲜来源摘要；不是权威原文'))) throw new Error('最近正文超过预算且没有可用摘要，请重建记忆或增加上下文预算。');
  }
  for (const item of facts) if (add(source('fact', item.entry.id, item.entry.revisionId, item.entry.payload, '作者确认且来源仍有效的事实；kind 区分事实、误信与未来计划'))) selectedFacts.push(item);
  const terms = plan.characters.flatMap(character => [character, ...(snapshot.state.aliases[character] ?? [])]);
  for (const item of prior.slice(0, -2).reverse()) {
    const raw = book.revision(item.revisionId).content;
    if (!terms.some(term => raw.includes(term))) { omissions.push({ id: item.id, reason: 'no-character-or-alias-match' }); continue; }
    const summary = memory.summary(item.revisionId);
    add(source(summary ? 'summary' : 'chapter', item.id, item.revisionId, summary ?? raw, summary ? '相关旧章新鲜摘要' : '无可用摘要时回退正式原文'));
  }
  return { projectVersion: version, plan, sources, estimatedTokens, omissions, memory: memoryGroups(selectedFacts, plan, snapshot.state.aliases) };
}
