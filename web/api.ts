export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
let session: Promise<string> | undefined;
async function token(): Promise<string> {
  session ??= fetch('/api/session', { cache: 'no-store' }).then(async response => {
    if (!response.ok) throw new Error('无法建立本地会话，请确认工作台服务仍在运行。');
    return (await response.json() as { token: string }).token;
  }).catch(error => { session = undefined; throw error; });
  return session;
}
async function request(path: string, method = 'GET', body?: unknown): Promise<Response> {
  const response = await fetch(`/api${path}`, {
    method, cache: 'no-store', headers: { 'x-novel-token': await token(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).catch(() => { throw new Error('与本地服务的连接已中断。若刚刚发起任务，请先查看任务记录，避免重复请求。'); });
  if (!response.ok) {
    if (response.status === 401) session = undefined;
    const result = await response.json().catch(() => ({ error: { code: 'server', message: '本地服务未完成请求。' } })) as { error: { code: string; message: string } };
    throw new ApiError(response.status, result.error.code, result.error.message);
  }
  return response;
}
export const api = {
  get: async <T>(path: string): Promise<T> => await (await request(path)).json() as T,
  post: async <T>(path: string, body: unknown = {}): Promise<T> => await (await request(path, 'POST', body)).json() as T,
  download: async (path: string, filename: string): Promise<void> => {
    const blob = await (await request(path)).blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
