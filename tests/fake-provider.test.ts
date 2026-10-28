import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FakeProvider } from '../src/llm/fake-provider.js';

const input = { prompt: '写出第一章的开头。', maxOutputTokens: 256 };

describe('FakeProvider contract', () => {
  it('returns fixed text in order without inventing usage', async () => {
    const provider = new FakeProvider(['旧灯亮了。', '林舟停下脚步。']);
    expect(await provider.generateText(input)).toEqual({ value: '旧灯亮了。', modelId: 'fake-v1', usage: null });
    expect((await provider.generateText(input)).value).toBe('林舟停下脚步。');
    await expect(provider.generateText(input)).rejects.toThrow('固定响应已用完');
  });

  it('validates structured output using the requested schema', async () => {
    const provider = new FakeProvider(['{"title":"归港","order":1}']);
    const schema = z.strictObject({ title: z.string(), order: z.number().int().positive() });
    expect((await provider.generateObject({ ...input, schema })).value).toEqual({ title: '归港', order: 1 });
  });

  it.each([
    ['not-json', 'invalid-json'],
    ['{"order":"wrong-type"}', 'invalid-schema'],
    ['   ', 'empty-response'],
  ])('rejects invalid response %s', async (response, kind) => {
    const provider = new FakeProvider([response]);
    await expect(provider.generateObject({ ...input, schema: z.strictObject({ order: z.number() }) }))
      .rejects.toMatchObject({ name: 'ModelOutputError', kind });
  });

  it('does not consume a response when already cancelled', async () => {
    const provider = new FakeProvider(['仍可使用。']);
    const controller = new AbortController();
    controller.abort();
    await expect(provider.generateText({ ...input, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect((await provider.generateText(input)).value).toBe('仍可使用。');
  });

  it('rejects an in-flight request when cancelled', async () => {
    const provider = new FakeProvider(['不应交付的候选。']);
    const controller = new AbortController();
    const pending = provider.generateText({ ...input, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each([0, -1, 0.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('rejects invalid token limit %s', async (maxOutputTokens) => {
    const provider = new FakeProvider(['固定响应。']);
    await expect(provider.generateText({ ...input, maxOutputTokens })).rejects.toThrow('正整数');
  });

  it('rejects a blank prompt', async () => {
    await expect(new FakeProvider(['固定响应。']).generateText({ ...input, prompt: ' \n ' })).rejects.toThrow('不能为空');
  });
});
