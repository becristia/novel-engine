import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { BookStore } from '../storage/book-store.js';
import { Library } from './library.js';
import { Jobs } from './jobs.js';
import type { TransportFactory } from './jobs.js';
import type { LoadedConfig } from '../llm/config.js';
import { CommitService } from '../application/workspace.js';
import { workbenchAction } from '../application/workbench-actions.js';
import { configurationView, revisionView, runView, workspaceView } from '../application/workbench-query.js';
import { HttpError, publicError } from '../application/workbench-errors.js';
import { buildContext } from '../context/builder.js';
import { buildSceneContext } from '../context/story-builder.js';
import { PatchService } from '../proposals/patches.js';
import { replayRun } from '../workflows/replay.js';

export const MAX_BODY_BYTES = 12 * 1024 * 1024;
const versionSchema = z.string().regex(/^(0|[1-9]\d*)$/u).transform(Number).pipe(z.number().int().nonnegative());
const openSchema = z.strictObject({ directory: z.string().trim().min(1).max(500), title: z.string().trim().min(1).max(200).optional() });
const importSchema = z.strictObject({ filename: z.string().min(1).max(256).regex(/^[^/\\\u0000]+$/u), content: z.string().max(MAX_BODY_BYTES), apply: z.boolean(), expectedVersion: z.number().int().nonnegative() });
export interface AppOptions { library: Library; origin: () => string; config: () => Promise<LoadedConfig>; transport?: TransportFactory }
export function createWorkbenchApp(options: AppOptions) {
  const token = randomBytes(32).toString('hex');
  const jobs = new Jobs(options.library, options.config, options.transport);
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  const body = async (request: Request): Promise<unknown> => {
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'content-type', '请求必须使用 JSON。');
    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new HttpError(413, 'body-too-large', '上传内容超过大小限制。');
    return JSON.parse(raw);
  };
  const useBook = <T>(id: string, write: boolean, action: (book: BookStore) => T): T => {
    const book = new BookStore(options.library.path(id), false, !write);
    try { return action(book); } finally { book.close(); }
  };
  const guard = (request: Request) => {
    const allowed = new URL(options.origin());
    if (request.headers.get('host') !== allowed.host || (request.headers.has('origin') && request.headers.get('origin') !== allowed.origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'origin', '拒绝来自其他站点的请求。');
  };
  const handle = async (request: Request): Promise<Response> => {
    try {
      guard(request);
      const url = new URL(request.url); const parts = url.pathname.split('/').filter(Boolean); const method = request.method;
      if (url.pathname === '/api/session' && method === 'GET') return json({ token });
      if (request.headers.get('x-novel-token') !== token) throw new HttpError(401, 'session', '本地会话已失效，请重新加载页面。');
      if (url.pathname === '/api/config' && method === 'GET' || url.pathname === '/api/config/check' && method === 'POST') return json(configurationView(await options.config()));
      if (url.pathname === '/api/workspaces') {
        if (method === 'GET') return json(options.library.list());
        if (method === 'POST') { const input = openSchema.parse(await body(request)); return json(options.library.open(input.directory, input.title), 201); }
      }
      if (parts[0] !== 'api' || parts[1] !== 'workspaces' || !parts[2]) throw new HttpError(404, 'not-found', '接口不存在。');
      const id = parts[2]; const resource = parts[3];
      if (!resource && method === 'GET') return json(useBook(id, false, workspaceView));
      if (resource === 'jobs' && method === 'POST') return json(await jobs.start(id, await body(request)), 202);
      if (resource === 'actions' && method === 'POST') { const input = await body(request); return json(useBook(id, true, book => workbenchAction(book, input))); }
      if (resource === 'import' && method === 'POST') {
        const input = importSchema.parse(await body(request)); const bytes = Buffer.from(input.content, 'base64');
        if (bytes.length > 8 * 1024 * 1024) throw new HttpError(413, 'file-too-large', '稿件最大支持 8 MiB。');
        if (!bytes.length || bytes.toString('base64') !== input.content) throw new HttpError(400, 'file-invalid', '上传文件编码无效。');
        return json(useBook(id, input.apply, book => new CommitService(book).importBytes(bytes, `upload:${input.filename}`, input.apply, input.expectedVersion)));
      }
      if (resource === 'revisions' && parts[4] && method === 'GET') return json(useBook(id, false, book => revisionView(book, parts[4]!)));
      if (resource === 'snapshot' && method === 'GET') return json(useBook(id, false, book => book.snapshot(versionSchema.parse(url.searchParams.get('version')))));
      if (resource === 'context' && method === 'GET') {
        const config = await options.config();
        if (url.searchParams.has('scene')) return json(useBook(id, false, book => buildSceneContext(book, z.string().min(1).parse(url.searchParams.get('scene')), config.config)));
        const chapter = z.coerce.number().int().positive().parse(url.searchParams.get('chapter'));
        return json(useBook(id, false, book => buildContext(book, chapter, config.config)));
      }
      if (resource === 'preview' && method === 'POST') {
        const input = z.strictObject({ proposalId: z.string().min(1), groups: z.array(z.string()).optional() }).parse(await body(request));
        return json(useBook(id, false, book => new PatchService(book).preview(input.proposalId, input.groups)));
      }
      if (resource === 'runs' && parts[4]) {
        if (parts[5] === 'replay' && method === 'POST') return json(replayRun(options.library.path(id), parts[4]));
        if (!parts[5] && method === 'GET') return json(useBook(id, false, book => runView(book, parts[4]!)));
      }
      if (resource === 'export' && method === 'GET') {
        const version = versionSchema.parse(url.searchParams.get('version')); const format = z.enum(['markdown', 'txt']).parse(url.searchParams.get('format'));
        return useBook(id, false, book => new Response(new CommitService(book).exportText(version, format), {
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${book.project().title}-v${version}.${format === 'markdown' ? 'md' : 'txt'}`)}` },
        }));
      }
      throw new HttpError(404, 'not-found', '接口不存在。');
    } catch (error) { const result = publicError(error); return json({ error: { code: result.code, message: result.message } }, result.status); }
  };
  return { handle, guard, jobs };
}
