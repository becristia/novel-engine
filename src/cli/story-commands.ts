import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { StoryStore, StoryCollectionSchema } from '../storage/story-store.js';
import { versionNumber } from '../domain/workspace.js';
import { withWorkspace } from './workspace-commands.js';
import type { CliIO } from './program.js';
import { hindsightStatus } from '../context/hindsight.js';
import { buildSceneContext } from '../context/story-builder.js';
import { loadConfig } from '../llm/config.js';
import { StoryTaskSchema } from '../domain/story-memory.js';

export function registerStoryCommands(program: Command, io: CliIO) {
  const show = (value: unknown) => io.stdout(`${JSON.stringify(value, null, 2)}\n`);
  const story = program.command('story').description('场景、人物认知、披露和版本化故事记忆。');
  story.command('service-status').description('仅显示检索准入记录，不请求外部服务。').action(() => show(hindsightStatus));
  story.command('context <scene>').option('--task <task>', 'writer、planner、reviewer、extractor 或 impact。', 'writer').option('--version <version>', '指定项目快照。', versionNumber)
    .action(async (scene: string, options: { task: string; version?: number }, command: Command) => {
      const config = await loadConfig(command.optsWithGlobals<{ config?: string }>().config);
      show(await withWorkspace(command, book => buildSceneContext(book, scene, config.config, options.version, StoryTaskSchema.parse(options.task))));
    });
  story.command('candidate <revision>').action(async (revision: string, _options: unknown, command: Command) => show(await withWorkspace(command, book => new StoryStore(book).candidate(revision))));
  story.command('correct <id>').requiredOption('--file <file>', '纠正后的完整断言 JSON，保留原来源。').requiredOption('--expected-version <version>', '预期项目版本。', versionNumber)
    .action(async (id: string, options: { file: string; expectedVersion: number }, command: Command) => {
      const value: unknown = JSON.parse(await readFile(options.file, 'utf8')); show(await withWorkspace(command, book => new StoryStore(book).correct(id, value, options.expectedVersion)));
    });
  story.command('show').option('--version <version>', '查看历史快照。', versionNumber)
    .action(async (options: { version?: number }, command: Command) => show(await withWorkspace(command, book => new StoryStore(book).view(options.version))));
  story.command('save').requiredOption('--file <file>', '完整故事状态 JSON。').requiredOption('--expected-version <version>', '预期项目版本。', versionNumber)
    .action(async (options: { file: string; expectedVersion: number }, command: Command) => {
      const value: unknown = JSON.parse(await readFile(options.file, 'utf8'));
      show(await withWorkspace(command, book => new StoryStore(book).save(value, options.expectedVersion)));
    });
  story.command('set <collection>').requiredOption('--file <file>', '单个场景、事件或记忆记录 JSON。').requiredOption('--expected-version <version>', '预期项目版本。', versionNumber)
    .action(async (collection: string, options: { file: string; expectedVersion: number }, command: Command) => {
      const name = StoryCollectionSchema.parse(collection); const value: unknown = JSON.parse(await readFile(options.file, 'utf8'));
      show(await withWorkspace(command, book => new StoryStore(book).upsert(name, value, options.expectedVersion)));
    });
  story.command('confirm <ids...>').requiredOption('--expected-version <version>', '预期项目版本。', versionNumber)
    .action(async (ids: string[], options: { expectedVersion: number }, command: Command) => show(await withWorkspace(command, book => new StoryStore(book).confirm(ids, options.expectedVersion))));
  story.command('apply <revision>').requiredOption('--expected-version <version>', '预期项目版本。', versionNumber)
    .action(async (revision: string, options: { expectedVersion: number }, command: Command) => show(await withWorkspace(command, book => new StoryStore(book).applyCandidate(revision, options.expectedVersion))));
}
