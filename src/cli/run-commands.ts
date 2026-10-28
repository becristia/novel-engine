import { Command } from 'commander';
import { positiveInteger } from '../domain/workspace.js';
import { loadConfig } from '../llm/config.js';
import { createTransport } from '../llm/factory.js';
import { RunStore } from '../storage/run-store.js';
import { withWorkspace } from './workspace-commands.js';
import type { CliIO } from './program.js';
import { ProbeWorkflow } from '../workflows/probe.js';

export function registerRunCommands(program: Command, io: CliIO): void {
  const show = (value: unknown) => io.stdout(`${JSON.stringify(value, null, 2)}\n`);
  program.option('--config <path>', '模型配置文件。');
  program.command('models').description('模型能力探测。').command('probe')
    .option('--max-requests <count>', '最大请求数。', positiveInteger, 1)
    .option('--max-tokens <count>', '请求累计 token 预算。', positiveInteger, 4096)
    .action(async (options: { maxRequests: number; maxTokens: number }, command: Command) => {
      const loaded = await loadConfig(command.optsWithGlobals<{ config?: string }>().config);
      const transport = await createTransport(loaded);
      show(await withWorkspace(command, book => new ProbeWorkflow(book, loaded.config, transport, { maxRequests: options.maxRequests, maxTokens: options.maxTokens }, loaded.source).start()));
    });
  const run = program.command('run').description('查看和取消持久化运行。');
  run.command('inspect <id>').action(async (id: string, _options: unknown, command: Command) => {
    show(await withWorkspace(command, book => { const runs = new RunStore(book); return { run: runs.get(id), attempts: runs.attempts(id) }; }));
  });
  run.command('cancel <id>').action(async (id: string, _options: unknown, command: Command) => {
    await withWorkspace(command, book => new RunStore(book).cancel(id));
    show({ cancelled: id });
  });
}
