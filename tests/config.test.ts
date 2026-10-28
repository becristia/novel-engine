import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfig } from '../src/llm/config.js';

describe('configuration boundary', () => {
  let tempDirectory: string;

  beforeAll(async () => {
    await mkdir('.tmp/m0-tests', { recursive: true });
    tempDirectory = await mkdtemp(resolve('.tmp/m0-tests/config-'));
  });

  afterAll(async () => {
    if (tempDirectory) await rm(tempDirectory, { recursive: true });
  });

  it('uses an isolated valid fake configuration by default', async () => {
    const first = await loadConfig();
    first.config.model.maxOutputTokens = 1;
    const second = await loadConfig();
    expect(second.source).toBe('builtin');
    expect(second.config.model.maxOutputTokens).toBe(1024);
  });

  it('loads an explicitly selected valid configuration', async () => {
    const result = await loadConfig('fixtures/config/valid.json');
    expect(result.source).toBe(resolve('fixtures/config/valid.json'));
    expect(result.config.model.maxOutputTokens).toBe(256);
  });

  it('rejects a missing explicit file instead of silently falling back', async () => {
    await expect(loadConfig(join(tempDirectory, 'missing.json'))).rejects.toThrow('配置文件不存在');
  });

  it('rejects an invalid limit and identifies the field', async () => {
    await expect(loadConfig('fixtures/config/invalid.json')).rejects.toThrow('model.maxOutputTokens');
  });

  it('does not include raw JSON in syntax errors', async () => {
    const file = join(tempDirectory, 'malformed.json');
    await writeFile(file, '{"apiKey":"test-secret-must-not-appear",');
    const error = await loadConfig(file).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(String(error)).toContain('不是有效的 JSON');
    expect(String(error)).not.toContain('test-secret');
  });

  it('rejects unsupported fields without disclosing their values or names', async () => {
    const file = join(tempDirectory, 'unknown.json');
    const { config } = await loadConfig();
    await writeFile(file, JSON.stringify({ ...config, 'test-secret-key': 'test-secret-value' }));
    const error = await loadConfig(file).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(String(error)).not.toContain('test-secret');
  });
});
