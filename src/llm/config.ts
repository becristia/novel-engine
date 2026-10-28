import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppConfigSchema, defaultConfig } from '../domain/model-config.js';
import type { AppConfig } from '../domain/model-config.js';

export class ConfigurationError extends Error {
  constructor(message: string, readonly file: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export interface LoadedConfig {
  config: AppConfig;
  source: string;
}

export async function loadConfig(file?: string): Promise<LoadedConfig> {
  if (file === undefined) {
    return { config: AppConfigSchema.parse(defaultConfig()), source: 'builtin' };
  }

  const absolutePath = resolve(file);
  let raw: string;
  try {
    raw = await readFile(absolutePath, 'utf8');
  } catch (error) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
    throw new ConfigurationError(missing ? '配置文件不存在。' : '无法读取配置文件。', absolutePath);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ConfigurationError('配置文件不是有效的 JSON。', absolutePath);
  }

  const result = AppConfigSchema.safeParse(data);
  if (!result.success) {
    // Only schema-owned field paths are shown; input values and unknown keys stay private.
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.') || 'root'))];
    throw new ConfigurationError(`配置校验失败，请检查字段：${fields.join('、')}。`, absolutePath);
  }
  return { config: result.data, source: absolutePath };
}
