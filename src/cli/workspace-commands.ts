import { readFile } from 'node:fs/promises';
import { Command, Option } from 'commander';
import { positiveInteger, versionNumber } from '../domain/workspace.js';
import { createWorkspace, CommitService } from '../application/workspace.js';
import { BookStore } from '../storage/book-store.js';
import type { CliIO } from './program.js';

export async function withWorkspace<T>(command: Command, action: (store: BookStore) => T | Promise<T>): Promise<T> {
  const directory = command.optsWithGlobals<{ project?: string }>().project;
  if (!directory) throw new Error('请用 --project 指定工作区。');
  const store = new BookStore(directory);
  try { return await action(store); } finally { store.close(); }
}

export function registerWorkspaceCommands(program: Command, io: CliIO): void {
  const show = (value: unknown) => io.stdout(`${JSON.stringify(value, null, 2)}\n`);
  program.option('--project <path>', '指定小说工作区。');
  program.command('init <directory>').requiredOption('--title <title>', '作品标题。')
    .action((directory: string, options: { title: string }) => { createWorkspace(directory, options.title); show({ created: directory }); });
  program.command('import <file>').option('--preview', '预览拆章。').option('--apply', '确认导入。')
    .action(async (file: string, options: { apply?: boolean; preview?: boolean }, command: Command) => {
      if (Boolean(options.apply) === Boolean(options.preview)) throw new Error('请选择 --preview 或 --apply，且只能选择一个。');
      show(await withWorkspace(command, store => new CommitService(store).importFile(file, Boolean(options.apply))));
    });
  program.command('export').addOption(new Option('--format <format>', '导出格式。').choices(['markdown', 'txt']).default('markdown'))
    .option('--version <version>', '历史项目版本。', versionNumber).requiredOption('--out <file>', '新导出文件路径。')
    .action(async (options: { version?: number; out: string; format: 'markdown' | 'txt' }, command: Command) => {
      await withWorkspace(command, store => new CommitService(store).exportFile(options.out, options.version, options.format));
      show({ exported: options.out });
    });
  const chapter = program.command('chapter').description('查看和修改章节。');
  chapter.command('list').option('--version <version>', '历史版本。', versionNumber)
    .action(async (options: { version?: number }, command: Command) => show(await withWorkspace(command, store => store.snapshot(options.version))));
  chapter.command('show <id>').option('--version <version>', '历史版本。', versionNumber)
    .action(async (id: string, options: { version?: number }, command: Command) => {
      show(await withWorkspace(command, store => {
        const selected = store.snapshot(options.version).state.chapters.find(item => item.id === id);
        if (!selected) throw new Error('指定版本中没有该章节。');
        return store.revision(selected.revisionId);
      }));
    });
  chapter.command('replace <id>').requiredOption('--file <file>', '作者修订的正文文件。').requiredOption('--expected-version <version>', '预期项目版本。', versionNumber)
    .action(async (id: string, options: { file: string; expectedVersion: number }, command: Command) => {
      const content = await readFile(options.file, 'utf8');
      show(await withWorkspace(command, store => new CommitService(store).replace(id, content, options.expectedVersion)));
    });
  chapter.command('insert').requiredOption('--title <title>', '标题。').requiredOption('--file <file>', '正文文件。')
    .requiredOption('--position <position>', '插入位置，从 1 开始。', positiveInteger).requiredOption('--expected-version <version>', '预期版本。', versionNumber)
    .action(async (options: { title: string; file: string; position: number; expectedVersion: number }, command: Command) => {
      const content = await readFile(options.file, 'utf8');
      show(await withWorkspace(command, store => new CommitService(store).insert(options.title, content, options.position, options.expectedVersion)));
    });
  chapter.command('reorder <ids...>').requiredOption('--expected-version <version>', '预期版本。', versionNumber)
    .action(async (ids: string[], options: { expectedVersion: number }, command: Command) => show(await withWorkspace(command, store => new CommitService(store).reorder(ids, options.expectedVersion))));
}
