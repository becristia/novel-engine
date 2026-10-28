export class RequestFailure extends Error {
  constructor(readonly outcome: 'known' | 'unknown', readonly retryable: boolean, readonly code: string, message = `模型请求失败：${code}。`) {
    super(message); this.name = 'RequestFailure';
  }
}
