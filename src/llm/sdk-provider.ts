import { generateText, APICallError } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { AppConfig } from '../domain/model-config.js';
import type { ModelGateway, ModelRequest, ModelResult } from './model-gateway.js';

export type TextTransport = Pick<ModelGateway, 'generateText'>;
export class RequestFailure extends Error {
  constructor(readonly outcome: 'known' | 'unknown', readonly retryable: boolean, readonly code: string) {
    super(`模型请求失败：${code}。`);
    this.name = 'RequestFailure';
  }
}

export class SdkProvider implements TextTransport {
  private readonly model;
  constructor(config: AppConfig['model']) {
    if (config.provider !== 'openai-compatible') throw new Error('供应商配置类型错误。');
    const key = process.env[config.apiKeyEnv];
    if (!key) throw new Error(`未配置环境变量：${config.apiKeyEnv}。`);
    this.model = createOpenAICompatible({ name: 'configured', baseURL: config.baseURL, apiKey: key }).chatModel(config.modelId);
  }

  async generateText(request: ModelRequest): Promise<ModelResult<string>> {
    try {
      const result = await generateText({ model: this.model, prompt: request.prompt, maxOutputTokens: request.maxOutputTokens, maxRetries: 0, ...(request.signal ? { abortSignal: request.signal } : {}) });
      const inputTokens = result.usage.inputTokens;
      const outputTokens = result.usage.outputTokens;
      return { value: result.text, modelId: result.response.modelId, finishReason: result.finishReason, usage: inputTokens === undefined || outputTokens === undefined ? null : { inputTokens, outputTokens } };
    } catch (error) {
      if (APICallError.isInstance(error) && error.statusCode !== undefined) {
        const status = error.statusCode;
        throw new RequestFailure('known', status === 429 || status === 503, `http-${status}`);
      }
      // Do not serialize SDK errors: they may include headers or request bodies.
      throw new RequestFailure('unknown', false, 'response-not-confirmed');
    }
  }
}
