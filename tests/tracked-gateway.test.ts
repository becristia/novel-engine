import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createWorkspace } from '../src/application/workspace.js';
import { defaultConfig } from '../src/domain/model-config.js';
import { BookStore } from '../src/storage/book-store.js';
import { RunStore } from '../src/storage/run-store.js';
import { FakeProvider } from '../src/llm/fake-provider.js';
import { TrackedGateway } from '../src/llm/tracked-gateway.js';
import type { TextTransport } from '../src/llm/sdk-provider.js';

describe('persistent model boundary', () => {
  let directory: string;
  let book: BookStore;
  let runs: RunStore;
  beforeEach(async () => {
    await mkdir('.tmp/milestone-tests', { recursive: true });
    directory = await mkdtemp(resolve('.tmp/milestone-tests/gateway-'));
    createWorkspace(directory, '预算验证'); book = new BookStore(directory); runs = new RunStore(book);
  });
  afterEach(async () => { book.close(); await rm(directory, { recursive: true }); });
  const request = { prompt: '返回结果。', maxOutputTokens: 128, schema: z.strictObject({ ok: z.literal(true) }) };

  it('preserves raw failures, accounts for retries, and reuses a saved result', async () => {
    const run = runs.create('test', {}, defaultConfig(), { maxRequests: 2, maxTokens: 5000 });
    const provider = new FakeProvider(['not-json', '{"ok":true}']);
    const gateway = new TrackedGateway(runs, run.id, 'test:v1', provider);
    expect((await gateway.generateObject(request)).value).toEqual({ ok: true });
    const attempts = runs.attempts(run.id);
    expect(attempts.map(attempt => attempt.status)).toEqual(['failed', 'succeeded']);
    expect(attempts[0]!.raw).toBe('not-json');
    expect(attempts[1]!.usage).toBeNull();
    expect(attempts[1]!.estimatedCost).toBeNull();
    expect((await gateway.generateObject(request)).value).toEqual({ ok: true });
    expect(runs.attempts(run.id)).toHaveLength(2);
  });

  it('reserves before calling the model and rejects a repair outside the budget', async () => {
    const run = runs.create('test', {}, defaultConfig(), { maxRequests: 1, maxTokens: 5000 });
    const gateway = new TrackedGateway(runs, run.id, 'test:v1', new FakeProvider(['wrong', '{"ok":true}']));
    await expect(gateway.generateObject(request)).rejects.toThrow('预算不足');
    expect(runs.attempts(run.id)).toHaveLength(1);
    const tiny = runs.create('test', {}, defaultConfig(), { maxRequests: 1, maxTokens: 1 });
    await expect(new TrackedGateway(runs, tiny.id, 'test', new FakeProvider([])).generateObject(request)).rejects.toThrow('预算不足');
    expect(runs.attempts(tiny.id)).toHaveLength(0);
  });

  it('records timeout as unknown and does not automatically resend', async () => {
    const config = defaultConfig(); config.model.timeoutMs = 10;
    const run = runs.create('test', {}, config, { maxRequests: 2, maxTokens: 5000 });
    const hanging: TextTransport = { generateText: async () => new Promise(() => {}) };
    await expect(new TrackedGateway(runs, run.id, 'test', hanging).generateObject(request)).rejects.toThrow('结果不明');
    expect(runs.attempts(run.id)[0]!.status).toBe('unknown');
    const gateway = new TrackedGateway(runs, run.id, 'test', new FakeProvider(['{"ok":true}']));
    await expect(gateway.generateObject(request)).rejects.toThrow('--retry-unknown');
    expect(runs.attempts(run.id)).toHaveLength(1);
    const retried = new TrackedGateway(runs, run.id, 'test', new FakeProvider(['{"ok":true}']), true);
    expect((await retried.generateObject(request)).value).toEqual({ ok: true });
    expect((await gateway.generateObject(request)).value).toEqual({ ok: true });
    expect(runs.attempts(run.id)[0]!.status).toBe('unknown');
    expect(runs.attempts(run.id)).toHaveLength(2);
  });

  it('rejects a saved response when the run was cancelled', async () => {
    const run = runs.create('test', {}, defaultConfig(), { maxRequests: 2, maxTokens: 5000 });
    const gateway = new TrackedGateway(runs, run.id, 'test', new FakeProvider(['{"ok":true}']));
    await gateway.generateObject(request); runs.cancel(run.id);
    await expect(gateway.generateObject(request)).rejects.toThrow('已取消');
  });

  it('marks pending attempts unknown on recovery without releasing reservations', () => {
    const run = runs.create('test', {}, defaultConfig(), { maxRequests: 1, maxTokens: 5000 });
    const attempt = runs.reserve(run.id, 'test', 'input', '正文', 128);
    runs.recoverUnknown(run.id);
    expect(runs.attempts(run.id)[0]).toMatchObject({ status: 'unknown', reservedTokens: attempt.reservedTokens });
    expect(() => runs.reserve(run.id, 'test', 'input', '正文', 128)).toThrow('预算不足');
  });

  it('rejects incomplete outputs after saving raw content and usage', async () => {
    const run = runs.create('test', {}, defaultConfig(), { maxRequests: 2, maxTokens: 5000 });
    const transport: TextTransport = { generateText: async () => ({ value: '只有半段', modelId: 'fake-v1', usage: { inputTokens: 20, outputTokens: 10 }, finishReason: 'length' }) };
    await expect(new TrackedGateway(runs, run.id, 'test', transport).generateText(request)).rejects.toThrow('截断');
    expect(runs.attempts(run.id)[0]).toMatchObject({ raw: '只有半段', status: 'failed', error: 'incomplete-output' });
  });
});
