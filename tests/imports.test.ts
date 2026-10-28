import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('imports the CLI entry and model adapter without executing them or using the network', async () => {
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [
    '--import', 'tsx', '--import', './tests/deny-network.ts', '--input-type=module', '-e',
    "await import('./src/cli/main.ts'); await import('./src/llm/fake-provider.ts'); process.stdout.write('imported');",
  ], { cwd, timeout: 10_000 });
  expect(stdout).toBe('imported');
  expect(stderr).toBe('');
});
