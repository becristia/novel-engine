import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Library } from '../../src/server/library.js';
import { createHttpServer } from '../../src/server/http.js';
import { defaultConfig } from '../../src/domain/model-config.js';

await mkdir('.tmp/ui-implementation', { recursive: true });
const directory = await mkdtemp(resolve('.tmp/ui-implementation/browser-'));
const config = defaultConfig(); config.model.maxOutputTokens = 2048; config.model.contextWindowTokens = 32000;
const service = createHttpServer({ library: new Library(directory), config: async () => ({ config, source: 'builtin' }), staticDirectory: resolve('dist/web') });
await service.listen(3918);
const stop = () => { service.server.close(() => { void rm(directory, { recursive: true }).finally(() => process.exit(0)); }); };
process.once('SIGTERM', stop); process.once('SIGINT', stop);
