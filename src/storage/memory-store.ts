import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { FactSchema, ReferenceSchema } from '../domain/review.js';
import type { Extraction } from '../domain/review.js';
import { hash } from '../domain/workspace.js';
import { resolveReference, validateExtraction } from '../review/evidence.js';
import { BookStore } from './book-store.js';

export const SummarySchema = z.strictObject({ summary: z.string().min(1), evidence: z.array(ReferenceSchema).min(1) });
export interface MemoryEntry {
  id: string; kind: 'fact' | 'summary'; revisionId: string; contentHash: string; payload: string;
  status: 'pending' | 'fresh' | 'stale'; confirmed: number; origin: string; parentId: string | null;
}

export class MemoryStore {
  constructor(readonly book: BookStore) {}
  entries(): MemoryEntry[] {
    return this.book.db.prepare('SELECT id, kind, revision_id AS revisionId, content_hash AS contentHash, payload, status, confirmed, origin, parent_id AS parentId FROM memory_entries ORDER BY rowid').all() as MemoryEntry[];
  }
  private get(id: string): MemoryEntry {
    const item = this.book.db.prepare('SELECT id, kind, revision_id AS revisionId, content_hash AS contentHash, payload, status, confirmed, origin, parent_id AS parentId FROM memory_entries WHERE id = ?').get(id) as MemoryEntry | undefined;
    if (!item) throw new Error('记忆条目不存在。');
    return item;
  }
  private statusFor(revisionId: string): 'fresh' | 'pending' {
    return this.book.snapshot().state.chapters.some(chapter => chapter.revisionId === revisionId) ? 'fresh' : 'pending';
  }

  ingest(revisionId: string, extraction: Extraction): void {
    const revision = this.book.revision(revisionId);
    const checked = validateExtraction(this.book, extraction, revisionId);
    const status = this.statusFor(revisionId);
    this.book.db.prepare('INSERT INTO memory_sources VALUES (?, ?, ?) ON CONFLICT(revision_id) DO UPDATE SET status = excluded.status').run(revisionId, revision.contentHash, status);
    for (const fact of checked.facts) {
      const payload = JSON.stringify(fact); const id = hash(`fact:${revisionId}:${payload}`);
      // A correction is also a tombstone for the old extraction. Rebuilding the
      // same source must not revive it or copy it onto another revision.
      if (this.book.db.prepare('SELECT id FROM memory_entries WHERE parent_id=? LIMIT 1').get(id)) continue;
      this.book.db.prepare("INSERT INTO memory_entries VALUES (?, 'fact', ?, ?, ?, ?, 0, 'model', NULL) ON CONFLICT(id) DO UPDATE SET status = excluded.status, confirmed = CASE WHEN memory_entries.status = 'stale' THEN 0 ELSE memory_entries.confirmed END")
        .run(id, revisionId, revision.contentHash, payload, status);
    }
  }

  saveSummary(revisionId: string, value: unknown): void {
    const summary = SummarySchema.parse(value); const revision = this.book.revision(revisionId);
    const checked = { ...summary, evidence: summary.evidence.map(reference => resolveReference(this.book, reference, new Set([revisionId]))) };
    const payload = JSON.stringify(checked); const id = hash(`summary:${revisionId}:${payload}`);
    this.book.db.prepare("UPDATE memory_entries SET status = 'stale' WHERE kind = 'summary' AND revision_id = ?").run(revisionId);
    this.book.db.prepare("INSERT INTO memory_entries VALUES (?, 'summary', ?, ?, ?, ?, 0, 'model', NULL) ON CONFLICT(id) DO UPDATE SET status = excluded.status")
      .run(id, revisionId, revision.contentHash, payload, this.statusFor(revisionId));
  }

  needsExtraction(revisionId: string): boolean {
    const row = this.book.db.prepare('SELECT status, content_hash FROM memory_sources WHERE revision_id = ?').get(revisionId) as { status: string; content_hash: string } | undefined;
    return !row || row.status !== 'fresh' || row.content_hash !== this.book.revision(revisionId).contentHash;
  }

  summary(revisionId: string): string | undefined {
    const row = this.book.db.prepare("SELECT payload FROM memory_entries WHERE kind = 'summary' AND revision_id = ? AND status = 'fresh' AND content_hash = ? ORDER BY rowid DESC LIMIT 1").get(revisionId, this.book.revision(revisionId).contentHash) as { payload: string } | undefined;
    return row ? SummarySchema.parse(JSON.parse(row.payload)).summary : undefined;
  }

  confirm(ids: string[]): { version: number; confirmed: string[] } {
    if (!ids.length || new Set(ids).size !== ids.length) throw new Error('确认条目不能为空或重复。');
    return this.book.db.transaction(() => {
      const entries = ids.map(id => this.get(id));
      for (const entry of entries) {
        if (entry.kind !== 'fact' || entry.status === 'stale') throw new Error('只能确认未失效的事实。');
        resolveReference(this.book, FactSchema.parse(JSON.parse(entry.payload)).evidence, new Set([entry.revisionId]));
        if (entry.status === 'pending') {
          const available = this.book.db.prepare("SELECT p.id FROM proposals p JOIN runs r ON p.run_id = r.id WHERE p.status = 'pending' AND p.base_version = ? AND r.cancelled = 0 AND ((p.kind = 'draft' AND json_extract(p.payload, '$.revisionId') = ?) OR (p.kind = 'selection' AND EXISTS (SELECT 1 FROM json_each(p.payload, '$.drafts') WHERE json_extract(value, '$.revisionId') = ?)))").get(this.book.project().version, entry.revisionId, entry.revisionId);
          if (!available) throw new Error('事实来源候选已过期，不能确认。');
        }
      }
      const update = () => { for (const id of ids) this.book.db.prepare('UPDATE memory_entries SET confirmed = 1 WHERE id = ?').run(id); };
      const current = this.book.project().version;
      if (entries.some(entry => entry.status === 'fresh')) this.book.commit(current, randomUUID(), hash(JSON.stringify(ids)), () => update());
      else update();
      return { version: this.book.project().version, confirmed: ids };
    }).immediate();
  }

  correct(id: string, value: unknown): { id: string; version: number } {
    const fact = FactSchema.parse(value); const original = this.get(id);
    if (original.kind !== 'fact' || original.status !== 'fresh' || fact.evidence.revisionId !== original.revisionId) throw new Error('只能纠正当前正式来源的事实，不能改变来源版本。');
    const checked = validateExtraction(this.book, { facts: [fact] }, original.revisionId).facts[0]!;
    const replacementId = randomUUID(); const version = this.book.project().version;
    this.book.commit(version, randomUUID(), hash(JSON.stringify({ id, checked })), state => {
      if (this.get(id).status !== 'fresh' || !state.chapters.some(chapter => chapter.revisionId === original.revisionId)) throw new Error('纠正的事实来源已过期。');
      this.book.db.prepare("UPDATE memory_entries SET status = 'stale' WHERE id = ?").run(id);
      this.book.db.prepare("INSERT INTO memory_entries VALUES (?, 'fact', ?, ?, ?, 'fresh', 1, 'author-correction', ?)").run(replacementId, original.revisionId, original.contentHash, JSON.stringify(checked), id);
      state.confirmedFactIds = state.confirmedFactIds.filter(item => item !== id);
    });
    return { id: replacementId, version: this.book.project().version };
  }

  setAliases(entity: string, names: string[]): void {
    if (!entity.trim() || !names.length || names.some(name => !name.trim())) throw new Error('人物身份和别名不能为空。');
    const others = Object.entries(this.book.snapshot().state.aliases).filter(([id]) => id !== entity).flatMap(([id, values]) => [id, ...values]);
    if ([entity, ...names].some(name => others.includes(name))) throw new Error('同一别名不能同时指向不同角色。');
    this.book.commit(this.book.project().version, randomUUID(), hash(JSON.stringify({ entity, names })), state => { state.aliases[entity] = [...new Set(names)]; });
  }

  setConstraints(value: unknown, expectedVersion: number): void {
    const constraints = z.array(z.string().min(1)).parse(value);
    this.book.commit(expectedVersion, randomUUID(), hash(JSON.stringify(constraints)), state => { state.constraints = constraints; });
  }
}
