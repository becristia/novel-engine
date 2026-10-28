import { setTimeout as delay } from 'node:timers/promises';
import type { ModelGateway, ModelRequest, ModelResult, StructuredModelRequest } from './model-gateway.js';
import { RequestFailure } from './request-failure.js';

export class ModelOutputError extends Error {
  constructor(readonly kind: 'invalid-json' | 'invalid-schema' | 'empty-response') {
    super(`模型响应无效：${kind}。`);
    this.name = 'ModelOutputError';
  }
}

export class FakeProvider implements ModelGateway {
  private readonly responses: readonly string[];
  private cursor = 0;

  constructor(responses: readonly string[]) {
    this.responses = [...responses];
  }

  private async readResponse(request: ModelRequest): Promise<string> {
    request.signal?.throwIfAborted();
    if (typeof request.prompt !== 'string' || request.prompt.trim().length === 0) {
      throw new TypeError('模型输入不能为空。');
    }
    if (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0) {
      throw new TypeError('输出 token 上限必须是正整数。');
    }
    const response = this.responses[this.cursor];
    if (response === undefined) {
      throw new RequestFailure('known', false, 'fake-responses-exhausted', 'FakeProvider 的固定响应已用完。');
    }
    this.cursor += 1;
    // A real async boundary lets offline tests exercise in-flight cancellation.
    await delay(0, undefined, { signal: request.signal });
    request.signal?.throwIfAborted();
    if (response.trim().length === 0) {
      throw new ModelOutputError('empty-response');
    }
    return response;
  }

  async generateText(request: ModelRequest): Promise<ModelResult<string>> {
    return { value: await this.readResponse(request), modelId: 'fake-v1', usage: null };
  }

  async generateObject<T>(request: StructuredModelRequest<T>): Promise<ModelResult<T>> {
    const raw = await this.readResponse(request);
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new ModelOutputError('invalid-json');
    }
    const result = request.schema.safeParse(data);
    if (!result.success) {
      throw new ModelOutputError('invalid-schema');
    }
    return { value: result.data, modelId: 'fake-v1', usage: null };
  }
}
