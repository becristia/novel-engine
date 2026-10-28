import { loadConfig } from '../llm/config.js';

export interface DoctorReport {
  ok: boolean;
  offline: true;
  node: { version: string; supported: boolean };
  config: { source: string; provider: 'fake'; modelId: 'fake-v1' };
}

export function isSupportedNode(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return major === 24 && (minor > 22 || (minor === 22 && patch >= 1));
}

export async function runDoctor(file?: string, nodeVersion = process.versions.node): Promise<DoctorReport> {
  const { config, source } = await loadConfig(file);
  const supported = isSupportedNode(nodeVersion);
  return {
    ok: supported,
    offline: true,
    node: { version: nodeVersion, supported },
    config: { source, provider: config.model.provider, modelId: config.model.modelId },
  };
}
