import { Command, CommanderError } from 'commander';
import { ConfigurationError } from '../llm/config.js';
import { runDoctor } from './doctor.js';
import { formatField, formatHumanText } from './format.js';
import { registerWorkspaceCommands } from './workspace-commands.js';
import { registerRunCommands } from './run-commands.js';
import { registerCreationCommands } from './creation-commands.js';
import { registerCompletionCommands } from './completion-commands.js';

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const defaultIO: CliIO = {
  stdout: (text) => { process.stdout.write(text); },
  stderr: (text) => { process.stderr.write(text); },
};

export async function runCli(args: string[], io: CliIO = defaultIO): Promise<number> {
  const program = new Command();
  let exitCode = 0;
  program
    .name('novel-engine')
    .description(formatHumanText('小说创作核心的离线工具。'))
    .version('0.0.0', '-V, --version', formatHumanText('显示版本号。'))
    .exitOverride()
    .enablePositionalOptions()
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr })
    .helpOption('-h, --help', formatHumanText('显示帮助信息。'))
    .addHelpCommand('help [command]', formatHumanText('查看命令帮助。'))
    .showHelpAfterError()
    .action(() => { program.outputHelp(); });

  program.command('doctor')
    .description(formatHumanText('离线检查 Node.js 版本和模型配置。'))
    .option('--offline', formatHumanText('仅检查本地环境，不调用模型。'))
    .option('--config <path>', formatHumanText('指定 JSON 配置文件；默认使用内置假模型配置。'))
    .option('--json', formatHumanText('输出机器可读的 JSON。'))
    .action(async (options: { offline?: boolean; config?: string; json?: boolean }, command: Command) => {
      if (!options.offline) {
        throw new Error('请添加 --offline 执行离线检查。');
      }
      const report = await runDoctor(options.config ?? command.optsWithGlobals<{ config?: string }>().config);
      exitCode = report.ok ? 0 : 1;
      if (options.json) {
        io.stdout(`${JSON.stringify(report, null, 2)}\n`);
        return;
      }
      io.stdout(`${formatField('Node.js 版本', report.node.version)}\n`);
      io.stdout(`${formatField('配置来源', report.config.source === 'builtin' ? '内置 FakeProvider 配置' : report.config.source)}\n`);
      io.stdout(`${formatField('模型', report.config.modelId)}\n`);
      io.stdout(`${formatHumanText(report.ok
        ? '离线检查通过，未调用模型。'
        : '运行环境不匹配，需要 Node.js 24.22.1 或更高的 24.x 版本。')}\n`);
    });

  registerWorkspaceCommands(program, io);
  registerRunCommands(program, io);
  registerCreationCommands(program, io);
  registerCompletionCommands(program, io);

  try {
    await program.parseAsync(args, { from: 'user' });
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode;
    if (error instanceof ConfigurationError) {
      io.stderr(`${formatHumanText(error.message)}\n${formatField('配置文件', error.file)}\n`);
    } else {
      io.stderr(`${formatHumanText(error instanceof Error ? error.message : '命令执行失败。')}\n`);
    }
    return 1;
  }
}
