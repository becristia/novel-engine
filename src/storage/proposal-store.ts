import { randomUUID } from 'node:crypto';
import { BookStore } from './book-store.js';

export interface Proposal {
  id: string; kind: 'plan' | 'draft' | 'patch' | 'selection'; baseVersion: number; revisionId: string; payload: unknown;
  status: 'pending' | 'approved' | 'rejected' | 'stale' | 'superseded'; runId: string; parentId: string | null;
}
export class ProposalStore {
  constructor(readonly book: BookStore) {}
  create(kind: Proposal['kind'], baseVersion: number, payload: unknown, runId: string, parentId: string | null = null): Proposal {
    const id = randomUUID();
    this.book.db.prepare("INSERT INTO proposals VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)").run(id, kind, baseVersion, randomUUID(), JSON.stringify(payload), runId, parentId, new Date().toISOString());
    return this.get(id);
  }
  get(id: string): Proposal {
    const row = this.book.db.prepare('SELECT id, kind, base_version AS baseVersion, revision_id AS revisionId, payload, status, run_id AS runId, parent_id AS parentId FROM proposals WHERE id = ?').get(id) as Omit<Proposal, 'payload'> & { payload: string } | undefined;
    if (!row) throw new Error('提案不存在。');
    return { ...row, payload: JSON.parse(row.payload) };
  }
  list(): Proposal[] {
    return (this.book.db.prepare('SELECT id FROM proposals ORDER BY rowid').all() as { id: string }[]).map(row => this.get(row.id));
  }
  status(id: string, status: Proposal['status']): void {
    this.book.db.prepare('UPDATE proposals SET status = ? WHERE id = ?').run(status, id);
  }
}
