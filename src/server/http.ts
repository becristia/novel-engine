import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, extname, sep } from 'node:path';
import { createWorkbenchApp, MAX_BODY_BYTES } from './app.js';
import type { AppOptions } from './app.js';
import { publicError } from '../application/workbench-errors.js';

export function createHttpServer(options: Omit<AppOptions, 'origin'> & { staticDirectory: string }) {
  let origin = 'http://127.0.0.1';
  const app = createWorkbenchApp({ ...options, origin: () => origin });
  const server = createServer(async (incoming, outgoing) => {
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      const url = new URL(incoming.url ?? '/', origin);
      app.guard(new Request(url, { headers }));
      let response: Response;
      if (url.pathname.startsWith('/api/')) {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of incoming) {
          size += Buffer.byteLength(chunk);
          if (size > MAX_BODY_BYTES) { outgoing.writeHead(413); outgoing.end('请求超过大小限制。'); return; }
          chunks.push(Buffer.from(chunk));
        }
        const method = incoming.method ?? 'GET';
        response = await app.handle(new Request(url, { headers, method, ...(['GET', 'HEAD'].includes(method) ? {} : { body: Buffer.concat(chunks) }) }));
      } else {
        if (incoming.method !== 'GET' && incoming.method !== 'HEAD') { outgoing.writeHead(405); outgoing.end(); return; }
        const root = resolve(options.staticDirectory); const path = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
        const file = await realpath(resolve(root, `.${path}`)); const rel = relative(root, file);
        if (rel === '..' || rel.startsWith(`..${sep}`)) { outgoing.writeHead(403); outgoing.end(); return; }
        const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
        response = new Response(await readFile(file), { headers: {
          'Content-Type': types[extname(file)] ?? 'application/octet-stream',
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
          'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
        } });
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      const result = publicError(error); outgoing.writeHead(result.status, { 'Content-Type': 'application/json' }); outgoing.end(JSON.stringify({ error: { code: result.code, message: result.message } }));
    }
  });
  return { app, server, listen: (port = 3917): Promise<string> => new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') { reject(new Error('无法取得本地端口。')); return; }
      origin = `http://127.0.0.1:${address.port}`; resolveListen(origin);
    });
  }) };
}
