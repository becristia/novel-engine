import { Command } from 'commander';
import { positiveInteger } from '../domain/workspace.js';
import { loadConfig } from '../llm/config.js';
import { createTransport } from '../llm/factory.js';
import { CreationWorkflow } from '../workflows/creation.js';
import { RunStore } from '../storage/run-store.js';
import { withWorkspace } from './workspace-commands.js';
import type { CliIO } from './program.js';
import { MemoryWorkflow } from '../workflows/memory.js';
import { ImpactWorkflow } from '../workflows/impact.js';
import { ProposalStore } from '../storage/proposal-store.js';
import { ProbeWorkflow } from '../workflows/probe.js';

export function registerCompletionCommands(program: Command, io: CliIO): void {
  const show = (value: unknown) => io.stdout(`${JSON.stringify(value, null, 2)}\n`);
  const limits = (command: Command) => command.option('--max-requests <count>', '运行请求上限。', positiveInteger, 8).option('--max-tokens <count>', '运行 token 预算。', positiveInteger, 64000);
  const chapter = program.commands.find(command => command.name() === 'chapter')!;
  limits(chapter.command('review').requiredOption('--revision <id>', '候选正文版本。'))
    .action(async (options: { revision: string; maxRequests: number; maxTokens: number }, command: Command) => {
      const loaded = await loadConfig(command.optsWithGlobals<{ config?: string }>().config);
      const transport = await createTransport(loaded);
      show(await withWorkspace(command, book => new CreationWorkflow(book, loaded.config, transport, { maxRequests: options.maxRequests, maxTokens: options.maxTokens }, loaded.source).review(options.revision)));
    });
  limits(chapter.command('revise').requiredOption('--revision <id>', '候选正文版本。').requiredOption('--instruction <text>', '作者修订要求。'))
    .action(async (options: { revision: string; instruction: string; maxRequests: number; maxTokens: number }, command: Command) => {
      const loaded = await loadConfig(command.optsWithGlobals<{ config?: string }>().config);
      const transport = await createTransport(loaded);
      show(await withWorkspace(command, book => new CreationWorkflow(book, loaded.config, transport, { maxRequests: options.maxRequests, maxTokens: options.maxTokens }, loaded.source).revise(options.revision, options.instruction)));
    });
  limits(program.command('workflow').description('执行可恢复的创作流程。').command('write').requiredOption('--chapter <number>', '计划章节序号。', positiveInteger).option('--revise-once', '审稿有问题时最多自动修订一轮。'))
    .action(async (options: { chapter: number; reviseOnce?: boolean; maxRequests: number; maxTokens: number }, command: Command) => {
      const loaded = await loadConfig(command.optsWithGlobals<{ config?: string }>().config);
      const transport = await createTransport(loaded);
      show(await withWorkspace(command, book => new CreationWorkflow(book, loaded.config, transport, { maxRequests: options.maxRequests, maxTokens: options.maxTokens }, loaded.source).write(options.chapter, Boolean(options.reviseOnce))));
    });
  const run = program.commands.find(command => command.name() === 'run')!;
  run.command('list').action(async (_options: unknown, command: Command) => show(await withWorkspace(command, book => book.db.prepare('SELECT id, kind, status, error, created_at FROM runs ORDER BY rowid DESC').all())));
  run.command('resume <id>').option('--retry-unknown', '明确重试结果不明的请求，保留原预算记录。')
    .action(async (id: string, options: { retryUnknown?: boolean }, command: Command) => {
      show(await withWorkspace(command, async book => {
        const stored = new RunStore(book).get(id);
        if (stored.kind === 'selection') {
          if (stored.status !== 'succeeded') new RunStore(book).assertRunnable(id);
          return { runId: id, proposal: new ProposalStore(book).list().find(proposal => proposal.runId === id) };
        }
        const input = stored.input as { configSource?: string };
        const transport = await createTransport({ config: stored.config, source: input.configSource ?? 'builtin' }, new RunStore(book).attempts(id).length);
        if (stored.kind === 'memory') return new MemoryWorkflow(book, stored.config, transport, stored.budget, input.configSource ?? 'builtin').resume(id, Boolean(options.retryUnknown));
        if (stored.kind === 'impact') return new ImpactWorkflow(book, stored.config, transport, stored.budget, input.configSource ?? 'builtin').resume(id, Boolean(options.retryUnknown));
        if (stored.kind === 'probe') return new ProbeWorkflow(book, stored.config, transport, stored.budget, input.configSource ?? 'builtin').resume(id, Boolean(options.retryUnknown));
        return new CreationWorkflow(book, stored.config, transport, stored.budget, input.configSource ?? 'builtin').resume(id, Boolean(options.retryUnknown));
      }));
    });
}
