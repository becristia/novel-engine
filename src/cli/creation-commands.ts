import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { positiveInteger } from '../domain/workspace.js';
import { ProposalService } from '../application/proposals.js';
import { loadConfig } from '../llm/config.js';
import { createTransport } from '../llm/factory.js';
import { buildContext } from '../context/builder.js';
import { CreationWorkflow } from '../workflows/creation.js';
import { withWorkspace } from './workspace-commands.js';
import type { CliIO } from './program.js';

export function registerCreationCommands(program: Command, io: CliIO): void {
  const show = (value: unknown) => io.stdout(`${JSON.stringify(value, null, 2)}\n`);
  const configure = (command: Command) => command.option('--max-requests <count>', '运行请求上限。', positiveInteger, 8).option('--max-tokens <count>', '运行 token 预算。', positiveInteger, 64000);
  configure(program.command('plan').requiredOption('--brief <file>', '创作要求文件。').option('--chapters <count>', '计划章节数。', positiveInteger, 3))
    .action(async (options: { brief: string; chapters: number; maxRequests: number; maxTokens: number }, command: Command) => {
      const loaded = await loadConfig(command.optsWithGlobals<{ config?: string }>().config);
      const transport = await createTransport(loaded);
      const brief = await readFile(options.brief, 'utf8');
      show(await withWorkspace(command, book => new CreationWorkflow(book, loaded.config, transport, { maxRequests: options.maxRequests, maxTokens: options.maxTokens }, loaded.source).plan(brief, options.chapters)));
    });
  const chapter = program.commands.find(command => command.name() === 'chapter')!;
  configure(chapter.command('draft').requiredOption('--chapter <number>', '计划中的章节序号。', positiveInteger).option('--dry-run', '仅显示上下文，不调用模型。'))
    .action(async (options: { chapter: number; dryRun?: boolean; maxRequests: number; maxTokens: number }, command: Command) => {
      const loaded = await loadConfig(command.optsWithGlobals<{ config?: string }>().config);
      if (options.dryRun) { show(await withWorkspace(command, book => buildContext(book, options.chapter, loaded.config))); return; }
      const transport = await createTransport(loaded);
      show(await withWorkspace(command, book => new CreationWorkflow(book, loaded.config, transport, { maxRequests: options.maxRequests, maxTokens: options.maxTokens }, loaded.source).draft(options.chapter)));
    });
  const proposal = program.command('proposal').description('查看、编辑和批准提案。');
  proposal.command('list').action(async (_options: unknown, command: Command) => show(await withWorkspace(command, book => new ProposalService(book).proposals.list())));
  proposal.command('show <id>').action(async (id: string, _options: unknown, command: Command) => show(await withWorkspace(command, book => new ProposalService(book).proposals.get(id))));
  proposal.command('approve <id>').option('--reason <reason>', '作者处理意见。', '')
    .action(async (id: string, options: { reason: string }, command: Command) => show(await withWorkspace(command, book => new ProposalService(book).approve(id, options.reason))));
  proposal.command('reject <id>').action(async (id: string, _options: unknown, command: Command) => {
    await withWorkspace(command, book => new ProposalService(book).reject(id)); show({ rejected: id });
  });
  proposal.command('edit-plan <id>').requiredOption('--chapter <number>', '计划中的章节序号。', positiveInteger).requiredOption('--file <file>', '完整章节计划 JSON。')
    .action(async (id: string, options: { chapter: number; file: string }, command: Command) => {
      const value: unknown = JSON.parse(await readFile(options.file, 'utf8'));
      show(await withWorkspace(command, book => new ProposalService(book).editPlan(id, options.chapter, value)));
    });
}
