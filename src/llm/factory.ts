import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { LoadedConfig } from './config.js';
import { FakeProvider } from './fake-provider.js';
import { SdkProvider } from './sdk-provider.js';
import type { TextTransport } from './sdk-provider.js';

export async function createTransport(loaded: LoadedConfig): Promise<TextTransport> {
  const config = loaded.config.model;
  if (config.provider === 'openai-compatible') return new SdkProvider(config);
  if (!config.responsesFile) return new FakeProvider(['{"ok":true}']);
  const base = loaded.source === 'builtin' ? process.cwd() : dirname(loaded.source);
  try {
    const responses = z.array(z.string()).parse(JSON.parse(await readFile(resolve(base, config.responsesFile), 'utf8')));
    return new FakeProvider(responses);
  } catch {
    throw new Error('固定响应文件无法读取或不是字符串数组。');
  }
}
