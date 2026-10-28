import type { AppConfig } from '../domain/model-config.js';
import { BookStore } from '../storage/book-store.js';

export interface ContextSource { kind: 'constraint' | 'plan' | 'chapter'; id: string; revisionId: string; text: string; reason: string; estimatedTokens: number }
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
  for (const item of snapshot.state.chapters) {
    if (item.id === plan.chapterId) continue;
    sources.push(source('chapter', item.id, item.revisionId, book.revision(item.revisionId).content, '已接受的正文来源'));
  }
  const estimatedTokens = sources.reduce((sum, item) => sum + item.estimatedTokens, 0);
  if (estimatedTokens + config.model.maxOutputTokens + 1024 > config.model.contextWindowTokens) throw new Error('上下文超出预算，未静默截断作者约束或正文。');
  return { projectVersion: version, plan, sources, estimatedTokens };
}
