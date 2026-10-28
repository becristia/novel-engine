import { Socket } from 'node:net';

const denyNetwork = (): never => {
  throw new Error('离线测试禁止发送外部请求。');
};

globalThis.fetch = async () => denyNetwork();
Socket.prototype.connect = denyNetwork;
