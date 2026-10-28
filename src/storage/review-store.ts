import { randomUUID } from 'node:crypto';
import { ReviewSchema, ExtractionSchema } from '../domain/review.js';
import type { Review, Extraction } from '../domain/review.js';
import { BookStore } from './book-store.js';

export interface ReportRow { id: string; revisionId: string; contentHash: string; baseVersion: number; runId: string; status: string; payload: string }
export class ReviewStore {
  constructor(readonly book: BookStore) {}

  save(table: 'reviews' | 'extractions', revisionId: string, baseVersion: number, runId: string, status: string, payload: unknown): string {
    const id = randomUUID(); const revision = this.book.revision(revisionId);
    this.book.db.prepare(`INSERT INTO ${table} VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, revisionId, revision.contentHash, baseVersion, runId, status, JSON.stringify(payload));
    return id;
  }

  latest(table: 'reviews' | 'extractions', revisionId: string): ReportRow | undefined {
    return this.book.db.prepare(`SELECT id, revision_id AS revisionId, content_hash AS contentHash, base_version AS baseVersion, run_id AS runId, status, payload FROM ${table} WHERE revision_id = ? ORDER BY rowid DESC LIMIT 1`).get(revisionId) as ReportRow | undefined;
  }

  approvedReports(revisionId: string, baseVersion: number): { review: Review; extraction: Extraction; reviewId: string } {
    const revision = this.book.revision(revisionId);
    const review = this.latest('reviews', revisionId); const extraction = this.latest('extractions', revisionId);
    if (!review || review.status !== 'reviewed' || review.baseVersion !== baseVersion || review.contentHash !== revision.contentHash) throw new Error('缺少绑定当前候选版本的有效审稿报告。');
    if (!extraction || extraction.status !== 'extracted' || extraction.baseVersion !== baseVersion || extraction.contentHash !== revision.contentHash) throw new Error('缺少绑定当前候选版本的事实提取结果。');
    for (const report of [review, extraction]) {
      const run = this.book.db.prepare('SELECT cancelled FROM runs WHERE id = ?').get(report.runId) as { cancelled: number };
      if (run.cancelled) throw new Error('报告所属运行已取消，请重新审稿。');
    }
    return { review: ReviewSchema.parse(JSON.parse(review.payload)), extraction: ExtractionSchema.parse(JSON.parse(extraction.payload)), reviewId: review.id };
  }
}
