import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Banner, Button, Empty, Icon, PageHeader } from './components.js';
import { LibraryPage } from './pages/Library.js';
import { pageNames, workspacePath } from './model.js';
import type { Page, WorkspaceSummary, WorkspaceView } from './model.js';

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
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const currentId = useRef(workspace); currentId.current = workspace;
  const notify = useCallback((text: string, error = false) => setNotice({ text, error }), []);
  const refresh = useCallback(async () => {
    const library = await api.get<WorkspaceSummary[]>('/workspaces'); setEntries(library);
    const id = currentId.current;
    if (id && library.some(item => item.id === id)) { const result = await api.get<WorkspaceView>(workspacePath(id)); if (currentId.current === id) setData(result); }
  }, []);
  const select = (id: string) => { setData(null); setWorkspace(id); localStorage.setItem('novel-workspace', id); };
  const navigate = (next: Page) => { setPage(next); location.hash = `/${next}`; };
  const perform = async <T,>(operation: () => Promise<T>): Promise<T> => {
    setBusy(true);
    try { return await operation(); }
    catch (error) { notify(error instanceof Error ? error.message : '操作未完成。', true); throw error; }
    finally { setBusy(false); }
  };
  useEffect(() => {
    let active = true;
    void api.get<WorkspaceSummary[]>('/workspaces').then(items => {
      if (!active) return; setEntries(items);
      const stored = localStorage.getItem('novel-workspace'); setWorkspace(items.find(item => item.id === stored)?.id ?? items[0]?.id ?? '');
    }).catch(error => { if (active) notify(error.message, true); });
    return () => { active = false; };
  }, [notify]);
  useEffect(() => { if (workspace) void refresh().catch(error => notify(error.message, true)); }, [workspace, refresh, notify]);
  useEffect(() => { const listener = () => setPage(initialPage()); window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener); }, []);
  const running = Boolean(data?.runs.some(run => ['running', 'queued'].includes(run.status)));
  useEffect(() => { if (!running) return; const timer = setInterval(() => { void refresh().catch(error => notify(error.message, true)); }, 1500); return () => clearInterval(timer); }, [running, refresh, notify]);
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="#/books">novel-engine</a><button className="book-selector" onClick={() => navigate('books')}><span>{entries.find(item => item.id === workspace)?.title ?? '选择作品'}</span><Icon name="down" size={18}/></button><small className="book-hint">本地作品</small>
      <nav aria-label="工作台导航">{navigation.map(item => <a key={item.page} className={page === item.page ? 'active' : ''} href={`#/${item.page}`}><Icon name={item.icon}/><span>{item.label}</span></a>)}</nav>
      <a className={`settings-link ${page === 'settings' ? 'active' : ''}`} href="#/settings"><Icon name="settings"/><span>模型与设置</span></a>
    </aside>
    <main className="main"><div className="app-caption">本地工作台</div>{notice && <div className="notice" role={notice.error ? 'alert' : 'status'}><Banner tone={notice.error ? 'red' : 'green'}>{notice.text}</Banner><Button variant="ghost" icon="close" aria-label="关闭提示" onClick={() => setNotice(null)}/></div>}
      {page === 'books' ? <LibraryPage entries={entries} selected={workspace} onSelect={select} refresh={refresh} busy={busy} perform={perform} notify={notify}/> : <><PageHeader title={pageNames[page]}/><Empty title={data ? '准备开始创作' : '选择一部作品'} detail={data ? '当前作品的创作内容将在这里显示。' : '打开已有作品，或导入自己的稿件。'}><Button variant="primary" onClick={() => navigate('books')}>打开作品入口</Button></Empty></>}
    </main>
  </div>;
}
