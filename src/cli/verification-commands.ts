import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { replayRun } from '../workflows/replay.js';
import { evaluationStatus, compareEvaluation } from '../application/evaluation.js';
import type { CliIO } from './program.js';
import { storyEvaluationStatus, compareStoryEvaluation } from '../application/story-evaluation.js';

export function registerVerificationCommands(program: Command, io: CliIO): void {
  const show = (value: unknown) => io.stdout(`${JSON.stringify(value, null, 2)}\n`);
  const run = program.commands.find(command => command.name() === 'run')!;
  run.command('replay <id>').requiredOption('--offline', '只读重放已保存响应，不请求模型。')
    .action((id: string, _options: unknown, command: Command) => {
      const directory = command.optsWithGlobals<{ project?: string }>().project;
      if (!directory) throw new Error('请用 --project 指定工作区。');
      const result = replayRun(directory, id); show(result);
      if (!result.ok) throw new Error('重放存在未确认请求或校验失败，请查看检查结果。');
    });
  const evaluation = program.command('evaluation').description('查看真实效果评测条件和比较人工记录。');
  evaluation.command('status').action(() => show(evaluationStatus()));
  evaluation.command('story-status').action(() => show(storyEvaluationStatus()));
  evaluation.command('story-compare').requiredOption('--file <file>', '按 StoryEvaluationSchema 填写的成对记忆评测记录。').action(async (options: { file: string }) => {
    const result = compareStoryEvaluation(JSON.parse(await readFile(options.file, 'utf8'))); show(result);
    if (!result.passed) throw new Error('记忆效果评测未通过或资料不完整。');
  });
  evaluation.command('compare').requiredOption('--file <file>', '按 EvaluationSchema 填写的人工评测 JSON。')
    .action(async (options: { file: string }) => {
      const result = compareEvaluation(JSON.parse(await readFile(options.file, 'utf8'))); show(result);
      if (!result.passed) throw new Error('效果评测未通过或资料不完整。');
    });
}
