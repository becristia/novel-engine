import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { MemoryStore } from '../storage/memory-store.js';
import { MemoryWorkflow } from '../workflows/memory.js';
import { loadConfig } from '../llm/config.js';
import { createTransport } from '../llm/factory.js';
import { buildContext } from '../context/builder.js';
import { positiveInteger, versionNumber } from '../domain/workspace.js';
import { withWorkspace } from './workspace-commands.js';
import type { CliIO } from './program.js';

export function registerMemoryCommands(program: Command, io: CliIO): void {
  const show = (value: unknown) => io.stdout(`${JSON.stringify(value, null, 2)}\n`);
  const memory = program.command('memory').description('检查来源、确认事实和重建记忆。');
  memory.command('status').action(async (_options: unknown, command: Command) => show(await withWorkspace(command, book => {
    const state = book.snapshot().state;
    return { version: book.project().version, sources: book.db.prepare('SELECT * FROM memory_sources').all(), entries: new MemoryStore(book).entries().map(entry => ({ ...entry, payload: JSON.parse(entry.payload) as unknown, usedInContext: entry.kind === 'fact' && entry.status === 'fresh' && state.confirmedFactIds.includes(entry.id) })) };
  })));
  memory.command('confirm <ids...>').action(async (ids: string[], _options: unknown, command: Command) => show(await withWorkspace(command, book => new MemoryStore(book).confirm(ids))));
  memory.command('correct <id>').requiredOption('--file <file>', '包含完整事实与来源的 JSON。')
    .action(async (id: string, options: { file: string }, command: Command) => {
      const value: unknown = JSON.parse(await readFile(options.file, 'utf8'));
      show(await withWorkspace(command, book => new MemoryStore(book).correct(id, value)));
    });
  memory.command('alias').requiredOption('--entity <id>', '稳定角色身份。').requiredOption('--names <names...>', '别名列表。')
    .action(async (options: { entity: string; names: string[] }, command: Command) => {
      await withWorkspace(command, book => new MemoryStore(book).setAliases(options.entity, options.names)); show({ entity: options.entity, names: options.names });
    });
  memory.command('rebuild').option('--chapter <id>', '只重建指定正式章节。')
    .option('--max-requests <count>', '运行请求上限。', positiveInteger, 16).option('--max-tokens <count>', '运行 token 预算。', positiveInteger, 128000)
    .action(async (options: { chapter?: string; maxRequests: number; maxTokens: number }, command: Command) => {
      const loaded = await loadConfig(command.optsWithGlobals<{ config?: string }>().config); const transport = await createTransport(loaded);
      show(await withWorkspace(command, book => new MemoryWorkflow(book, loaded.config, transport, { maxRequests: options.maxRequests, maxTokens: options.maxTokens }, loaded.source).rebuild(options.chapter)));
    });
  program.command('context').command('show').requiredOption('--chapter <number>', '计划章节序号。', positiveInteger)
    .action(async (options: { chapter: number }, command: Command) => {
      const loaded = await loadConfig(command.optsWithGlobals<{ config?: string }>().config);
      show(await withWorkspace(command, book => buildContext(book, options.chapter, loaded.config)));
    });
  program.command('constraints').command('set').requiredOption('--file <file>', '作者约束字符串数组。').requiredOption('--expected-version <version>', '项目基线版本。', versionNumber)
    .action(async (options: { file: string; expectedVersion: number }, command: Command) => {
      const value: unknown = JSON.parse(await readFile(options.file, 'utf8'));
      await withWorkspace(command, book => new MemoryStore(book).setConstraints(value, options.expectedVersion)); show({ updated: true });
    });
}
