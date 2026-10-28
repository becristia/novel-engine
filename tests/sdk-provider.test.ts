import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppConfigSchema } from '../src/domain/model-config.js';
import { SdkProvider } from '../src/llm/sdk-provider.js';

function config() {
  return AppConfigSchema.parse({ schemaVersion: 1, model: { provider: 'openai-compatible', modelId: 'test-model', baseURL: 'https://model.example.test/v1', apiKeyEnv: 'NOVEL_TEST_KEY', maxOutputTokens: 128 } }).model;
}

describe('AI SDK compatible adapter', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('fails before sending when the configured credential is absent', () => {
    vi.stubEnv('NOVEL_TEST_KEY', '');
    expect(() => new SdkProvider(config())).toThrow('未配置环境变量');
  });

  it('normalizes text and usage using a mocked compatible HTTP response', async () => {
    vi.stubEnv('NOVEL_TEST_KEY', 'test-only-key');
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'response-1', object: 'chat.completion', created: 1, model: 'test-model',
      choices: [{ index: 0, message: { role: 'assistant', content: '模型正文。' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const result = await new SdkProvider(config()).generateText({ prompt: '开始。', maxOutputTokens: 128 });
    expect(result.value).toBe('模型正文。');
    expect(result.providerResponseId).toBe('response-1'); expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 6 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    expect(body.model).toBe('test-model');
    expect(body.max_tokens).toBe(128);
  });

  it('disables SDK retries and does not disclose provider error details', async () => {
    vi.stubEnv('NOVEL_TEST_KEY', 'test-only-key');
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { message: 'private-response-detail' } }), { status: 429, headers: { 'Content-Type': 'application/json' } }));
    const error = await new SdkProvider(config()).generateText({ prompt: '开始。', maxOutputTokens: 128 }).catch((value: unknown) => value);
    expect(error).toMatchObject({ outcome: 'known', retryable: true, code: 'http-429' });
    expect(String(error)).not.toContain('private-response-detail');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
