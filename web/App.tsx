import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Banner, Button, Empty, Icon, PageHeader } from './components.js';
import { LibraryPage } from './pages/Library.js';
import { PlanningPage } from './pages/Planning.js';
import { ChaptersPage } from './pages/Chapters.js';
import { RunsPage } from './pages/Runs.js';
import { SettingsPage } from './pages/Settings.js';
import { MemoryPage } from './pages/Memory.js';
import { PatchesPage } from './pages/Patches.js';
import { VersionsPage } from './pages/Versions.js';
import { chapterCatalog, chapterCandidates, chapterStatus } from './chapters.js';
import { allowNavigation } from './hooks.js';
import { pageNames, workspacePath } from './model.js';
import type { ActionInput, Budget, ConfigurationView, Focus, JobInput, Page, PageProps, WorkspaceSummary, WorkspaceView } from './model.js';

const navigation: { page: Page; label: string; icon: string }[] = [
  { page: 'chapters', label: '章节工作台', icon: 'file' }, { page: 'planning', label: '规划', icon: 'list' },
  { page: 'memory', label: '故事记忆', icon: 'book' }, { page: 'patches', label: '局部改稿', icon: 'edit' },
  { page: 'runs', label: '任务记录', icon: 'task' }, { page: 'versions', label: '版本与导出', icon: 'export' },
];
function initialPage(): Page { const value = location.hash.replace('#/', ''); return value in pageNames ? value as Page : 'books'; }
export function App() {
  const [page, setPage] = useState<Page>(initialPage); const [workspace, setWorkspace] = useState('');
  const [entries, setEntries] = useState<WorkspaceSummary[]>([]); const [data, setData] = useState<WorkspaceView | null>(null);
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<ConfigurationView | null>(null);
  const [budget, setBudget] = useState<Budget>({ maxRequests: 8, maxTokens: 64000 });
  const [focus, setFocus] = useState<Focus>({});
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const currentId = useRef(workspace); currentId.current = workspace;
  const currentPage = useRef(page); currentPage.current = page;
  const notify = useCallback((text: string, error = false) => setNotice({ text, error }), []);
  const refreshConfig = useCallback(async () => setConfig(await api.get<ConfigurationView>('/config')), []);
  const refresh = useCallback(async () => {
    const library = await api.get<WorkspaceSummary[]>('/workspaces'); setEntries(library);
    const id = currentId.current;
    if (id && library.some(item => item.id === id)) { const result = await api.get<WorkspaceView>(workspacePath(id)); if (currentId.current === id) setData(result); }
  }, []);
  const select = (id: string) => { setData(null); setFocus({}); setWorkspace(id); localStorage.setItem('novel-workspace', id); };
  const navigate = (next: Page, nextFocus: Focus = {}) => { if (!allowNavigation()) return; setFocus(nextFocus); currentPage.current = next; setPage(next); location.hash = `/${next}`; };
  const perform = async <T,>(operation: () => Promise<T>): Promise<T> => {
    setBusy(true);
    try { return await operation(); }
    catch (error) { notify(error instanceof Error ? error.message : '操作未完成。', true); throw error; }
    finally { setBusy(false); }
  };
  const action = <T,>(input: ActionInput, expectedVersion = data?.project.version): Promise<T> => perform(async () => {
    if (!data) throw new Error('请先选择作品。');
    const value = await api.post<T>(workspacePath(data.project.id, 'actions'), { ...input, ...(input.action === 'cancel' ? {} : { expectedVersion }) });
    await refresh(); return value;
  });
  const job = (input: JobInput, requestBudget = budget) => perform(async () => {
    if (!data) throw new Error('请先选择作品。');
    const value = await api.post<{ runId: string | null }>(workspacePath(data.project.id, 'jobs'), { ...input, expectedVersion: data.project.version, requestId: crypto.randomUUID(), budget: requestBudget });
    await refresh(); return value;
  });
  useEffect(() => {
    let active = true;
    void api.get<WorkspaceSummary[]>('/workspaces').then(items => {
      if (!active) return; setEntries(items);
      const stored = localStorage.getItem('novel-workspace'); setWorkspace(items.find(item => item.id === stored)?.id ?? items[0]?.id ?? '');
    }).catch(error => { if (active) notify(error.message, true); });
    void refreshConfig().catch(error => { if (active) notify(error.message, true); });
    return () => { active = false; };
  }, [notify, refreshConfig]);
  useEffect(() => { if (workspace) void refresh().catch(error => notify(error.message, true)); }, [workspace, refresh, notify]);
  useEffect(() => {
    const listener = () => { const next = initialPage(); if (next !== currentPage.current && !allowNavigation()) { history.replaceState(null, '', `#/${currentPage.current}`); return; } setPage(next); };
    window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener);
  }, []);
  const running = Boolean(data?.runs.some(run => run.active));
  useEffect(() => { if (!running) return; const timer = setInterval(() => { void refresh().catch(error => notify(error.message, true)); }, 1500); return () => clearInterval(timer); }, [running, refresh, notify]);
  const props: PageProps | null = data ? { data, config, busy, budget, setBudget, focus, navigate, refresh, refreshConfig, notify, perform, action, job } : null;
  const chapters = data ? chapterCatalog(data) : [];
  const selectedChapter = focus.chapterId ?? (data ? chapters.find(chapter => chapterCandidates(data, chapter.id).some(item => item.proposal.status === 'pending' && !item.proposal.stale))?.id ?? chapters.find(chapter => !chapter.revisionId)?.id ?? chapters[0]?.id : null);
  return <div className={`app-shell ${page === 'chapters' && data ? 'chapter-mode' : ''}`}>
    <aside className="sidebar"><a className="brand" href="#/books" onClick={e => { e.preventDefault(); navigate('books'); }}>novel-engine</a><button className="book-selector" onClick={() => navigate('books')}><span>{entries.find(item => item.id === workspace)?.title ?? '选择作品'}</span><Icon name="down" size={18}/></button><small className="book-hint">本地作品</small>
      <nav aria-label="工作台导航">{navigation.map(item => <a key={item.page} className={page === item.page ? 'active' : ''} href={`#/${item.page}`} onClick={e => { e.preventDefault(); navigate(item.page); }}><Icon name={item.icon}/><span>{item.label}</span></a>)}</nav>
      {page === 'chapters' && data && <div className="sidebar-chapters"><div className="row-title"><strong>章节</strong><Button variant="ghost" icon="plus" aria-label="新增章节" onClick={() => navigate('chapters', { createChapter: true })}/></div>{chapters.map(chapter => <button key={chapter.id} className={selectedChapter === chapter.id ? 'selected' : ''} onClick={() => navigate('chapters', { chapterId: chapter.id })}><span className="chapter-number">{String(chapter.ordinal).padStart(2, '0')}</span><span className="chapter-name">{chapter.title}</span><small>{chapterStatus(data, chapter.id)}</small></button>)}</div>}
      <a className={`settings-link ${page === 'settings' ? 'active' : ''}`} href="#/settings" onClick={e => { e.preventDefault(); navigate('settings'); }}><Icon name="settings"/><span>模型与设置</span></a>
    </aside>
    <main className="main" data-page={page}><div className="app-caption">本地工作台</div>{notice && <div className="notice" role={notice.error ? 'alert' : 'status'}><Banner tone={notice.error ? 'red' : 'green'}>{notice.text}</Banner><Button variant="ghost" icon="close" aria-label="关闭提示" onClick={() => setNotice(null)}/></div>}
      {page === 'books' ? <LibraryPage entries={entries} selected={workspace} onSelect={select} refresh={refresh} busy={busy} perform={perform} notify={notify}/> : page === 'planning' && props ? <PlanningPage {...props}/> : page === 'chapters' && props ? <ChaptersPage {...props}/> : page === 'memory' && props ? <MemoryPage {...props}/> : page === 'patches' && props ? <PatchesPage {...props}/> : page === 'versions' && props ? <VersionsPage {...props}/> : page === 'runs' && props ? <RunsPage {...props}/> : page === 'settings' ? <SettingsPage config={config} data={data} budget={budget} setBudget={setBudget} busy={busy} perform={perform} refreshConfig={refreshConfig} notify={notify} job={job} navigate={navigate}/> : <><PageHeader title={pageNames[page]}/><Empty title={data ? '准备开始创作' : '选择一部作品'} detail={data ? '当前作品的创作内容将在这里显示。' : '打开已有作品，或导入自己的稿件。'}><Button variant="primary" onClick={() => navigate('books')}>打开作品入口</Button></Empty></>}
    </main>
  </div>;
}
