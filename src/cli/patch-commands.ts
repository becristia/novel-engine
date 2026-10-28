import { Command } from 'commander';
import { PatchService } from '../proposals/patches.js';
import { ImpactWorkflow } from '../workflows/impact.js';
import { loadConfig } from '../llm/config.js';
import { createTransport } from '../llm/factory.js';
import { positiveInteger, versionNumber } from '../domain/workspace.js';
import { CommitService } from '../application/workspace.js';
import { RunStore } from '../storage/run-store.js';
import { withWorkspace } from './workspace-commands.js';
import type { CliIO } from './program.js';

export function registerPatchCommands(program: Command, io: CliIO): void {
  const show = (value: unknown) => io.stdout(`${JSON.stringify(value, null, 2)}\n`);
  const limits = (command: Command) => command.option('--max-requests <count>', '请求上限。', positiveInteger, 8).option('--max-tokens <count>', '运行 token 预算。', positiveInteger, 64000);
  const chapter = program.commands.find(command => command.name() === 'chapter')!;
  limits(chapter.command('impact').requiredOption('--chapter <id>', '修改起点的稳定章节 ID。').requiredOption('--instruction <text>', '作者修改要求。'))
    .action(async (options: { chapter: string; instruction: string; maxRequests: number; maxTokens: number }, command: Command) => {
      const loaded = await loadConfig(command.optsWithGlobals<{ config?: string }>().config); const transport = await createTransport(loaded);
      show(await withWorkspace(command, book => new ImpactWorkflow(book, loaded.config, transport, { maxRequests: options.maxRequests, maxTokens: options.maxTokens }, loaded.source).analyze(options.chapter, options.instruction)));
    });
  chapter.command('restore <id>').requiredOption('--revision <revision>', '待恢复的同章历史版本。').requiredOption('--expected-version <version>', '当前项目版本。', versionNumber)
    .action(async (id: string, options: { revision: string; expectedVersion: number }, command: Command) => show(await withWorkspace(command, book => {
      const revision = book.revision(options.revision); if (revision.chapterId !== id) throw new Error('历史正文不属于该章节。');
      return new CommitService(book).replace(id, revision.content, options.expectedVersion);
    })));
  const proposal = program.commands.find(command => command.name() === 'proposal')!;
  proposal.command('preview <id>').option('--groups <ids...>', '预览指定修改组。')
    .action(async (id: string, options: { groups?: string[] }, command: Command) => show(await withWorkspace(command, book => new PatchService(book).preview(id, options.groups))));
  proposal.command('select <id>').requiredOption('--groups <ids...>', '选择完整的依赖组。')
    .action(async (id: string, options: { groups: string[] }, command: Command) => show(await withWorkspace(command, book => new PatchService(book).select(id, options.groups))));
  proposal.command('undo <id>').requiredOption('--expected-version <version>', '当前项目版本。', versionNumber)
    .action(async (id: string, options: { expectedVersion: number }, command: Command) => show(await withWorkspace(command, book => new PatchService(book).undo(id, options.expectedVersion))));
  limits(proposal.command('revalidate <id>'))
    .action(async (id: string, options: { maxRequests: number; maxTokens: number }, command: Command) => {
      show(await withWorkspace(command, async book => {
        const original = new PatchService(book).proposals.get(id); const run = new RunStore(book).get(original.runId);
        const file = command.optsWithGlobals<{ config?: string }>().config;
        const loaded = file ? await loadConfig(file) : { config: run.config, source: (run.input as { configSource?: string }).configSource ?? 'builtin' };
        const transport = await createTransport(loaded);
        return new ImpactWorkflow(book, loaded.config, transport, { maxRequests: options.maxRequests, maxTokens: options.maxTokens }, loaded.source).revalidate(id);
      }));
    });
  const lock = program.command('lock').description('作者锁定正文区块。');
  lock.command('list').action(async (_options: unknown, command: Command) => show(await withWorkspace(command, book => book.snapshot().state.locks)));
  lock.command('add').requiredOption('--chapter <id>', '章节 ID。').requiredOption('--block <id>', 'chapter show 返回的区块 ID。')
    .action(async (options: { chapter: string; block: string }, command: Command) => show(await withWorkspace(command, book => ({ lockId: new PatchService(book).lock(options.chapter, options.block) }))));
  lock.command('remove <id>').action(async (id: string, _options: unknown, command: Command) => {
    await withWorkspace(command, book => new PatchService(book).unlock(id)); show({ unlocked: id });
  });
}
