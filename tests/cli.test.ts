import { describe, expect, it } from 'vitest';
import { isSupportedNode, runDoctor } from '../src/cli/doctor.js';
import { runCli } from '../src/cli/program.js';

async function execute(args: string[]) {
  let stdout = '';
  let stderr = '';
  const code = await runCli(args, {
    stdout: (text) => { stdout += text; },
    stderr: (text) => { stderr += text; },
  });
  return { code, stdout, stderr };
}

describe('offline CLI', () => {
  it.each([{ args: [] }, { args: ['--help'] }])('shows help with arguments $args', async ({ args }) => {
    const result = await execute(args);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('doctor');
    expect(result.stderr).toBe('');
  });

  it('reports a successful offline check as JSON', async () => {
    const result = await execute(['doctor', '--offline', '--json']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, offline: true, config: { source: 'builtin', provider: 'fake' } });
    expect(result.stderr).toBe('');
  });

  it('checks an explicit valid configuration', async () => {
    const result = await execute(['doctor', '--offline', '--config', 'fixtures/config/valid.json']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('离线检查通过');
  });

  it('returns failure for an invalid configuration', async () => {
    const result = await execute(['doctor', '--offline', '--config', 'fixtures/config/invalid.json']);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('model.maxOutputTokens');
  });

  it('requires an explicit offline check', async () => {
    const result = await execute(['doctor']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--offline');
  });

  it('does not treat unknown flags as successful checks', async () => {
    expect((await execute(['doctor', '--offline', '--unknown'])).code).toBe(1);
  });

  it('fails clearly on an unsupported runtime', async () => {
    expect((await runDoctor(undefined, '22.20.0')).ok).toBe(false);
  });

  it.each([
    ['24.22.1', true], ['24.22.2', true], ['24.23.0', true],
    ['24.22.0', false], ['24.21.9', false], ['25.0.0', false], ['24.22.1-rc.1', false],
  ])('validates runtime %s', (version, expected) => {
    expect(isSupportedNode(version)).toBe(expected);
  });
});
