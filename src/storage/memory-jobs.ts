import type { Database } from 'better-sqlite3';
import type { BookState } from '../domain/workspace.js';
import { hash } from '../domain/workspace.js';
import type { BookStore } from './book-store.js';

export type MemoryJobStatus = 'pending' | 'inflight' | 'unknown' | 'failed' | 'succeeded' | 'obsolete';
export interface MemoryJob { id: string; baseVersion: number; sourceId: string; contentHash: string; kind: string; status: MemoryJobStatus; externalId: string | null; attempts: number; error: string | null; createdAt: string }

export function queueMemoryJobs(db: Database, projectId: string, state: BookState, version: number): void {
  const existing = db.prepare("SELECT id, source_id AS sourceId FROM memory_jobs WHERE status != 'obsolete'").all() as { id: string; sourceId: string }[];
  for (const job of existing) if (!state.chapters.some(item => item.revisionId === job.sourceId)) db.prepare("UPDATE memory_jobs SET status='obsolete' WHERE id=?").run(job.id);
  for (const chapter of state.chapters) {
    const revision = db.prepare('SELECT content_hash AS contentHash FROM revisions WHERE id=?').get(chapter.revisionId) as { contentHash: string };
    const id = hash(`${projectId}:${chapter.revisionId}:${revision.contentHash}:retain`);
    db.prepare("INSERT INTO memory_jobs (id, base_version, source_id, content_hash, kind, status, payload, created_at) VALUES (?, ?, ?, ?, 'retain', 'pending', ?, ?) ON CONFLICT(source_id, content_hash, kind) DO NOTHING")
      .run(id, version, chapter.revisionId, revision.contentHash, JSON.stringify({ projectId, chapterId: chapter.id, revisionId: chapter.revisionId }), new Date().toISOString());
  }
}

export class MemoryJobStore {
  constructor(readonly book: BookStore) {}
  list(): MemoryJob[] {
    return this.book.db.prepare('SELECT id, base_version AS baseVersion, source_id AS sourceId, content_hash AS contentHash, kind, status, external_id AS externalId, attempts, error, created_at AS createdAt FROM memory_jobs ORDER BY rowid').all() as MemoryJob[];
  }
  get(id: string) { const job = this.list().find(item => item.id === id); if (!job) throw new Error('记忆同步任务不存在。'); return job; }
  current(job: MemoryJob) { return this.book.snapshot().state.chapters.some(item => item.revisionId === job.sourceId) && this.book.revision(job.sourceId).contentHash === job.contentHash; }
  begin(id: string) {
    const result = this.book.db.transaction(() => {
      const job = this.get(id);
      if (!this.current(job)) { this.book.db.prepare("UPDATE memory_jobs SET status='obsolete' WHERE id=?").run(id); return this.get(id); }
      if (!['pending', 'failed'].includes(job.status)) throw new Error('记忆同步状态不允许重发，未知结果需要先查询外部操作。');
      this.book.db.prepare("UPDATE memory_jobs SET status='inflight', attempts=attempts+1, error=NULL WHERE id=?").run(id); return this.get(id);
    }).immediate();
    if (result.status === 'obsolete') throw new Error('记忆同步来源已经过期。');
    return result;
  }
  recordOperation(id: string, operationId: string) {
    if (!operationId.trim() || this.get(id).status !== 'inflight') throw new Error('记忆同步操作身份无效。');
    this.book.db.prepare('UPDATE memory_jobs SET external_id=? WHERE id=?').run(operationId, id);
  }
  finish(id: string, outcome: 'succeeded' | 'failed' | 'unknown') {
    return this.book.db.transaction(() => {
      const job = this.get(id);
      if (job.status === 'succeeded' || job.status === 'obsolete') return job;
      if (!['inflight', 'unknown'].includes(job.status)) throw new Error('记忆同步任务尚未发送。');
      const status = this.current(job) ? outcome : 'obsolete';
      this.book.db.prepare('UPDATE memory_jobs SET status=?, error=? WHERE id=?').run(status, outcome === 'succeeded' ? null : `external-${outcome}`, id);
      return this.get(id);
    }).immediate();
  }
  recover() { this.book.db.prepare("UPDATE memory_jobs SET status='unknown', error='interrupted-before-result' WHERE status='inflight'").run(); }
}
