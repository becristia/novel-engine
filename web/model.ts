import type { WorkspaceView, RevisionView, ConfigurationView } from '../src/application/workbench-query.js';
import type { WorkbenchAction, WorkbenchJob } from '../src/domain/workbench.js';
import type { Budget } from '../src/domain/run.js';
export type { WorkspaceView, RevisionView, ConfigurationView, Budget };
type WithoutVersion<T> = T extends unknown ? Omit<T, 'expectedVersion'> : never;
type JobDetails<T> = T extends unknown ? Omit<T, 'expectedVersion' | 'requestId' | 'budget'> : never;
export type ActionInput = WithoutVersion<WorkbenchAction>;
export type JobInput = JobDetails<WorkbenchJob>;
export type Page = 'books' | 'chapters' | 'planning' | 'memory' | 'patches' | 'runs' | 'versions' | 'settings';
export const pageNames: Record<Page, string> = { books: '作品入口', chapters: '章节工作台', planning: '章节规划', memory: '故事记忆', patches: '局部改稿', runs: '任务记录', versions: '版本与导出', settings: '模型与设置' };
export interface WorkspaceSummary { id: string; title: string; directory: string; version: number; chapterCount: number }
export interface Focus { chapterId?: string; revisionId?: string; runId?: string; proposalId?: string; createChapter?: boolean }
export interface PageProps {
  data: WorkspaceView;
  config: ConfigurationView | null;
  busy: boolean;
  budget: Budget;
  setBudget: (value: Budget) => void;
  focus: Focus;
  navigate: (page: Page, focus?: Focus) => void;
  refresh: () => Promise<void>;
  refreshConfig: () => Promise<void>;
  notify: (text: string, error?: boolean) => void;
  perform: <T>(operation: () => Promise<T>) => Promise<T>;
  action: <T = unknown>(input: ActionInput, expectedVersion?: number) => Promise<T>;
  job: (input: JobInput, budget?: Budget) => Promise<{ runId: string | null }>;
}
export function workspacePath(id: string, resource = ''): string { return `/workspaces/${encodeURIComponent(id)}${resource ? `/${resource}` : ''}`; }
export function modelReady(config: ConfigurationView | null): boolean { return Boolean(config?.offlineOk && config.credentialAvailable && (config.provider !== 'fake' || config.hasFakeResponses)); }
