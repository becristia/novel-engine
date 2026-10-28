import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { RunStore } from '../storage/run-store.js';

interface LeaseRow { run_id: string; token: string; pid: number; hostname: string; expires_at: number }
export class WriteLease {
  readonly token = randomUUID();
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(readonly runs: RunStore, readonly runId: string) {}

  acquire(): void {
    this.runs.book.db.transaction(() => {
      this.runs.assertRunnable(this.runId);
      const existing = this.runs.book.db.prepare('SELECT * FROM write_lease WHERE singleton = 1').get() as LeaseRow | undefined;
      let dead = false;
      if (existing?.hostname === hostname()) {
        try { process.kill(existing.pid, 0); } catch (error) { dead = error instanceof Error && 'code' in error && error.code === 'ESRCH'; }
      }
      if (existing && existing.expires_at > Date.now() && !dead) throw new Error('本作品已有运行持有写入权，请等待或取消该运行。');
      this.runs.book.db.prepare('INSERT OR REPLACE INTO write_lease VALUES (1, ?, ?, ?, ?, ?)').run(this.runId, this.token, process.pid, hostname(), Date.now() + 60000);
    }).immediate();
    this.timer = setInterval(() => {
      if (!this.runs.book.db.open) return;
      try { this.runs.book.db.prepare('UPDATE write_lease SET expires_at = ? WHERE token = ?').run(Date.now() + 60000, this.token); } catch { /* The next assertion rejects a lost lease. */ }
    }, 10000);
    this.timer.unref();
  }

  assert = (): void => {
    const row = this.runs.book.db.prepare('SELECT token, expires_at FROM write_lease WHERE singleton = 1').get() as { token: string; expires_at: number } | undefined;
    if (!row || row.token !== this.token || row.expires_at <= Date.now()) throw new Error('运行写入权已失效，拒绝迟到结果。');
    this.runs.assertRunnable(this.runId);
  };

  release(): void {
    if (this.timer) clearInterval(this.timer);
    this.runs.book.db.prepare('DELETE FROM write_lease WHERE token = ?').run(this.token);
  }

  fail(code: string): void {
    const row = this.runs.book.db.prepare('SELECT token FROM write_lease WHERE singleton = 1').get() as { token: string } | undefined;
    if (row?.token === this.token && !['stale', 'cancelled'].includes(this.runs.get(this.runId).status)) this.runs.status(this.runId, 'failed', code);
  }
}

export async function withRunLease<T>(runs: RunStore, id: string, action: (lease: WriteLease) => Promise<T>, recover = false): Promise<T> {
  const lease = new WriteLease(runs, id);
  lease.acquire();
  try {
    if (recover) runs.recoverUnknown(id);
    return await action(lease);
  } finally { lease.release(); }
}
