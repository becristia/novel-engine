import { Command } from 'commander';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Library } from './library.js';
import { createHttpServer } from './http.js';
import { loadConfig } from '../llm/config.js';
import { publicError } from '../application/workbench-errors.js';

const program = new Command().name('novel-workbench')
  .option('--library <directory>', '允许打开和创建作品的根目录。', './books')
  .option('--project <directory>', '启动时登记一个已有工作区。')
  .option('--config <file>', '显式模型配置文件。')
  .option('--port <number>', '本机监听端口。', value => {
    if (!/^\d+$/u.test(value) || Number(value) > 65535) throw new Error('端口无效。'); return Number(value);
  }, 3917);
try {
  program.parse(); const options = program.opts<{ library: string; project?: string; config?: string; port: number }>();
  const library = new Library(resolve(options.library));
  if (options.project) library.open(resolve(options.project));
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const service = createHttpServer({ library, config: () => loadConfig(options.config), staticDirectory: resolve(root, 'dist/web') });
  const url = await service.listen(options.port);
  process.stdout.write(`novel-engine 工作台：${url}\n`);
  const stop = () => { service.server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
} catch (error) { process.stderr.write(`${publicError(error).message}\n`); process.exitCode = 1; }
