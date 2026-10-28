import { runCli } from './program.js';

if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2));
}
