import { describe, expect, it } from 'vitest';
import { formatField, formatHumanText } from '../src/cli/format.js';

describe('human-readable output', () => {
  it('normalizes application-authored Chinese spacing and punctuation', () => {
    expect(formatHumanText('检查Node.js版本,共3项!')).toBe('检查 Node.js 版本，共 3 项！');
    expect(formatHumanText('检查完成—配置有效.')).toBe('检查完成--配置有效。');
  });

  it('keeps literal paths and URLs intact', () => {
    const literal = '/tmp/中文test/稿件—v1.json';
    expect(formatField('配置文件', literal)).toBe(`配置文件：${literal}`);
    expect(formatField('来源', 'https://example.com/a?q=中文test')).toBe('来源：https://example.com/a?q=中文test');
  });
});
