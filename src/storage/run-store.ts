import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppConfigSchema } from '../domain/model-config.js';
import type { AppConfig } from '../domain/model-config.js';
import type { ModelUsage } from '../llm/model-gateway.js';
import { BookStore } from './book-store.js';

export const BudgetSchema = z.strictObject({ maxRequests: z.number().int().positive(), maxTokens: z.number().int().positive() });
export type Budget = z.infer<typeof BudgetSchema>;
export type RunStatus = 'queued' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'cancelled' | 'stale';
export interface Run {
  id: string; kind: string; baseVersion: number; input: unknown; config: AppConfig; budget: Budget; status: RunStatus; error: string | null; cancelled: boolean;
}
export interface Attempt {
  id: string; runId: string; step: string; inputHash: string; prompt: string; maxOutputTokens: number; reservedTokens: number;
  status: 'inflight' | 'received' | 'succeeded' | 'failed' | 'unknown'; raw: string | null; usage: string | null;
  estimatedCost: number | null; priceVersion: string | null; error: string | null;
}

export class RunStore {
  constructor(readonly book: BookStore) {}

  artifact(id: string, name: string): unknown {
    const row = this.book.db.prepare('SELECT value FROM run_artifacts WHERE run_id = ? AND name = ?').get(id, name) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }

  saveArtifact(id: string, name: string, value: unknown): void {
    this.book.db.prepare('INSERT INTO run_artifacts VALUES (?, ?, ?)').run(id, name, JSON.stringify(value));
  }

  create(kind: string, input: unknown, config: AppConfig, budget: Budget, expectedBaseVersion?: number): Run {
    const id = randomUUID();
    const parsedConfig = AppConfigSchema.parse(config);
    const parsedBudget = BudgetSchema.parse(budget);
    this.book.db.transaction(() => {
      const version = this.book.project().version;
      if (expectedBaseVersion !== undefined && version !== expectedBaseVersion) throw new Error('创建运行前输入快照已改变，请重新准备上下文。');
      this.book.db.prepare('INSERT INTO runs (id, kind, base_version, input, config, budget, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, kind, version, JSON.stringify(input), JSON.stringify(parsedConfig), JSON.stringify(parsedBudget), 'queued', new Date().toISOString());
    }).immediate();
    return this.get(id);
  }

  get(id: string): Run {
    const row = this.book.db.prepare('SELECT id, kind, base_version AS baseVersion, input, config, budget, status, error, cancelled FROM runs WHERE id = ?').get(id) as Omit<Run, 'input' | 'config' | 'budget' | 'cancelled'> & { input: string; config: string; budget: string; cancelled: number } | undefined;
    if (!row) throw new Error('运行记录不存在。');
    return { ...row, input: JSON.parse(row.input), config: AppConfigSchema.parse(JSON.parse(row.config)), budget: BudgetSchema.parse(JSON.parse(row.budget)), cancelled: Boolean(row.cancelled) };
  }

  attempts(runId: string, step?: string): Attempt[] {
    return this.book.db.prepare(`SELECT id, run_id AS runId, step, input_hash AS inputHash, prompt, max_output_tokens AS maxOutputTokens, reserved_tokens AS reservedTokens, status, raw, usage, estimated_cost AS estimatedCost, price_version AS priceVersion, error FROM attempts WHERE run_id = ? ${step === undefined ? '' : 'AND step = ?'} ORDER BY rowid`)
      .all(...(step === undefined ? [runId] : [runId, step])) as Attempt[];
  }

  assertRunnable(id: string): Run {
    const run = this.get(id);
    if (run.cancelled) throw new Error('运行已取消，不能继续提交结果。');
    if (run.baseVersion !== this.book.project().version) {
      this.status(id, 'stale', 'input-version-changed');
      throw new Error('运行输入版本已过期，请新建任务。');
    }
    return run;
  }

  status(id: string, status: RunStatus, error: string | null = null): void {
    this.book.db.prepare('UPDATE runs SET status = ?, error = ? WHERE id = ? AND cancelled = 0').run(status, error, id);
  }

  cancel(id: string): void {
    this.get(id);
    this.book.db.transaction(() => {
      this.book.db.prepare("UPDATE runs SET status = 'cancelled', cancelled = 1 WHERE id = ?").run(id);
      this.book.db.prepare("UPDATE attempts SET status = 'unknown', error = 'cancelled-before-result' WHERE run_id = ? AND status = 'inflight'").run(id);
    }).immediate();
  }

  recoverUnknown(id: string): void {
    this.book.db.prepare("UPDATE attempts SET status = 'unknown', error = 'interrupted-before-result' WHERE run_id = ? AND status = 'inflight'").run(id);
  }

  reserve(runId: string, step: string, inputHash: string, prompt: string, maxOutputTokens: number): Attempt {
    return this.book.db.transaction(() => {
      const run = this.assertRunnable(runId);
      const attempts = this.attempts(runId);
      const reservedTokens = Buffer.byteLength(prompt, 'utf8') + 64 + maxOutputTokens;
      const used = attempts.reduce((sum, attempt) => {
        if (!attempt.usage) return sum + attempt.reservedTokens;
        const usage = JSON.parse(attempt.usage) as ModelUsage;
        return sum + usage.inputTokens + usage.outputTokens;
      }, 0);
      if (attempts.length >= run.budget.maxRequests || used + reservedTokens > run.budget.maxTokens) throw new Error('运行预算不足，未发送模型请求。');
      const id = randomUUID();
      this.book.db.prepare("INSERT INTO attempts (id, run_id, step, input_hash, prompt, max_output_tokens, reserved_tokens, status, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'inflight', ?)")
        .run(id, runId, step, inputHash, prompt, maxOutputTokens, reservedTokens, new Date().toISOString());
      this.status(runId, 'running');
      return this.attempts(runId, step).find(attempt => attempt.id === id)!;
    }).immediate();
  }

  receive(attempt: Attempt, raw: string, usage: ModelUsage | null): void {
    const prices = this.get(attempt.runId).config.model.prices;
    const validUsage = usage && Number.isFinite(usage.inputTokens) && usage.inputTokens >= 0 && Number.isFinite(usage.outputTokens) && usage.outputTokens >= 0 ? usage : null;
    const cost = prices && validUsage ? (validUsage.inputTokens * prices.inputPerMillion + validUsage.outputTokens * prices.outputPerMillion) / 1_000_000 : null;
    this.book.db.prepare("UPDATE attempts SET status = 'received', raw = ?, usage = ?, estimated_cost = ?, price_version = ?, finished_at = ? WHERE id = ? AND status = 'inflight'")
      .run(raw, validUsage ? JSON.stringify(validUsage) : null, cost, prices?.version ?? null, new Date().toISOString(), attempt.id);
  }

  finishAttempt(id: string, status: Attempt['status'], error: string | null = null): void {
    this.book.db.prepare('UPDATE attempts SET status = ?, error = ?, finished_at = ? WHERE id = ?').run(status, error, new Date().toISOString(), id);
  }
}
