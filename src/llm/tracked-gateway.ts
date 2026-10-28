import { z } from 'zod';
import { hash } from '../domain/workspace.js';
import { RunStore } from '../storage/run-store.js';
import type { ModelGateway, ModelRequest, ModelResult, StructuredModelRequest } from './model-gateway.js';
import { RequestFailure } from './sdk-provider.js';
import type { TextTransport } from './sdk-provider.js';

async function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export class TrackedGateway implements ModelGateway {
  constructor(readonly runs: RunStore, readonly runId: string, readonly step: string, readonly transport: TextTransport, readonly retryUnknown = false, readonly assertOwnership: () => void = () => {}) {}

  private async execute<T>(request: ModelRequest, schema?: z.ZodType<T>): Promise<ModelResult<T | string>> {
    request.signal?.throwIfAborted();
    this.assertOwnership();
    const run = this.runs.assertRunnable(this.runId);
    if (!request.prompt.trim() || !Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1) throw new Error('模型请求参数无效。');
    if (request.maxOutputTokens > run.config.model.maxOutputTokens) throw new Error('请求超出配置中的单次输出上限。');
    const prompt = schema ? `${request.prompt}\n只返回符合以下 JSON Schema 的 JSON，不要 Markdown 围栏：\n${JSON.stringify(z.toJSONSchema(schema))}` : request.prompt;
    if (Buffer.byteLength(prompt, 'utf8') + 64 + request.maxOutputTokens > run.config.model.contextWindowTokens) throw new Error('上下文预算不足，未截断硬约束。');
    const fingerprint = hash(JSON.stringify({ prompt, maxOutputTokens: request.maxOutputTokens, model: run.config.model }));
    const previous = this.runs.attempts(this.runId, this.step);
    if (previous.some(attempt => attempt.inputHash !== fingerprint)) throw new Error('步骤输入发生变化，请创建新的运行。');

    const parse = (raw: string): T | string => {
      if (!raw.trim()) throw new Error('empty-response');
      if (!schema) return raw;
      const value = JSON.parse(raw) as unknown;
      const parsed = schema.safeParse(value);
      if (!parsed.success) throw new Error('invalid-schema');
      return parsed.data;
    };
    const saved = previous.find(attempt => attempt.status === 'received' || attempt.status === 'succeeded');
    if (saved && (saved.finishReason === 'length' || saved.finishReason === 'content-filter')) {
      this.runs.finishAttempt(saved.id, 'failed', 'incomplete-output');
      this.runs.status(this.runId, 'failed', 'incomplete-output');
      throw new Error('已保存的模型输出被截断或过滤，不能在恢复时作为完整结果。');
    }
    if (saved?.raw !== null && saved?.raw !== undefined) {
      try {
        const value = parse(saved.raw);
        this.runs.finishAttempt(saved.id, 'succeeded');
        return { value, modelId: saved.responseModelId ?? run.config.model.modelId, ...(saved.providerResponseId ? { providerResponseId: saved.providerResponseId } : {}), ...(saved.finishReason ? { finishReason: saved.finishReason } : {}), usage: saved.usage ? JSON.parse(saved.usage) : null };
      } catch {
        this.runs.finishAttempt(saved.id, 'failed', 'invalid-output');
      }
    }
    if (previous.some(attempt => attempt.status === 'inflight')) throw new Error('存在结果未确认的在途请求，请先恢复运行状态。');
    if (previous.some(attempt => attempt.status === 'unknown') && !this.retryUnknown) throw new Error('存在 unknown 请求；需要显式 --retry-unknown，预留费用不会清零。');

    const failures = this.runs.attempts(this.runId, this.step).filter(attempt => attempt.status === 'failed').length;
    for (let retry = failures; retry < 2; retry += 1) {
      const attempt = this.runs.reserve(this.runId, this.step, fingerprint, prompt, request.maxOutputTokens);
      this.assertOwnership();
      const timeout = AbortSignal.timeout(run.config.model.timeoutMs);
      const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
      let response: ModelResult<string>;
      try {
        response = await withAbort(this.transport.generateText({ prompt, maxOutputTokens: request.maxOutputTokens, signal }), signal);
      } catch (error) {
        this.assertOwnership();
        const known = error instanceof RequestFailure && error.outcome === 'known';
        const code = error instanceof RequestFailure ? error.code : 'response-not-confirmed';
        this.runs.finishAttempt(attempt.id, known ? 'failed' : 'unknown', code);
        if (request.signal?.aborted) this.runs.cancel(this.runId);
        else this.runs.status(this.runId, 'failed', code);
        if (known && error.retryable && retry === 0) continue;
        throw new Error(known ? `模型请求被拒绝：${code}。` : '模型请求结果不明，已保留预算和 unknown 记录，未自动重发。');
      }
      this.assertOwnership();
      this.runs.receive(attempt, response.value, response.usage, response);
      if (response.finishReason === 'length' || response.finishReason === 'content-filter') {
        this.runs.finishAttempt(attempt.id, 'failed', 'incomplete-output');
        this.runs.status(this.runId, 'failed', 'incomplete-output');
        throw new Error('模型输出被截断或过滤，不能作为完整结果使用。');
      }
      this.runs.assertRunnable(this.runId);
      if (request.signal?.aborted) {
        this.runs.cancel(this.runId);
        throw new Error('运行已取消。');
      }
      try {
        const value = parse(response.value);
        this.runs.finishAttempt(attempt.id, 'succeeded');
        return { value, modelId: response.modelId, usage: response.usage };
      } catch {
        this.runs.finishAttempt(attempt.id, 'failed', 'invalid-output');
      }
    }
    this.runs.status(this.runId, 'failed', 'invalid-output');
    throw new Error('模型输出校验失败，有限修复次数已用完。');
  }

  async generateText(request: ModelRequest): Promise<ModelResult<string>> {
    return this.execute(request) as Promise<ModelResult<string>>;
  }
  async generateObject<T>(request: StructuredModelRequest<T>): Promise<ModelResult<T>> {
    return this.execute(request, request.schema) as Promise<ModelResult<T>>;
  }
}
