import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Badge, Banner, Button, Dialog, Field, Icon, PageHeader, Panel } from '../components.js';
import { workspacePath } from '../model.js';
import type { WorkspaceSummary } from '../model.js';

interface ImportPreview { chapters: { title: string; characters: number }[]; encoding: string; version: number; duplicate: boolean }
interface Props {
  entries: WorkspaceSummary[]; selected: string; onSelect: (id: string) => void; refresh: () => Promise<void>;
  busy: boolean; perform: <T>(operation: () => Promise<T>) => Promise<T>; notify: (text: string, error?: boolean) => void;
}
export function LibraryPage({ entries, selected, onSelect, refresh, busy, perform, notify }: Props) {
  const current = entries.find(item => item.id === selected); const picker = useRef<HTMLInputElement>(null);
  const [modal, setModal] = useState<'open' | 'create' | null>(null);
  const [title, setTitle] = useState(''); const [directory, setDirectory] = useState('');
  const [file, setFile] = useState<{ filename: string; content: string } | null>(null); const [preview, setPreview] = useState<ImportPreview | null>(null);
  useEffect(() => { setFile(null); setPreview(null); }, [selected]);
  const upload = async (chosen: File) => {
    if (!current) { notify('请先创建或打开作品。', true); return; }
    if (chosen.size > 8 * 1024 * 1024) { notify('稿件最大支持 8 MiB。', true); return; }
    await perform(async () => {
      const content = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]!); reader.onerror = () => reject(new Error('无法读取文件。')); reader.readAsDataURL(chosen); });
      const candidate = { filename: chosen.name, content };
      const result = await api.post<ImportPreview>(workspacePath(current.id, 'import'), { ...candidate, apply: false, expectedVersion: current.version });
      setFile(candidate); setPreview(result);
    });
  };
  const save = async () => {
    await perform(async () => {
      const result = await api.post<WorkspaceSummary>('/workspaces', { directory, ...(modal === 'create' ? { title } : {}) });
      await refresh(); onSelect(result.id); setModal(null); setDirectory(''); setTitle(''); notify(modal === 'create' ? '作品已创建。' : '工作区已打开。');
    });
  };
  return <>
    <PageHeader title="作品入口" subtitle="打开作品，或从已有稿件开始。" actions={<><Button onClick={() => setModal('open')}>打开工作区</Button><Button variant="primary" onClick={() => setModal('create')}>新建作品</Button></>}/>
    <div className="library-layout page-fill">
      <Panel title="最近打开" className="recent-books">
        <div className="book-list">{entries.length === 0 && <p className="muted">还没有打开过作品。</p>}{entries.map(entry => <button type="button" key={entry.id} className={`book-row ${entry.id === selected ? 'selected' : ''}`} onClick={() => onSelect(entry.id)}><Icon name="book" size={36}/><span><strong>{entry.title}</strong><small>{entry.chapterCount ? `${entry.chapterCount} 章正式稿` : '新作品 · 尚无正式稿'}</small></span><Icon name="arrow" size={18}/></button>)}</div>
        <p className="panel-foot muted">仅显示主动打开过的作品。</p>
      </Panel>
      <Panel className="import-panel">
        <div className="section-heading"><h2>导入稿件</h2>{current && <Badge tone="amber">当前作品：{current.title}</Badge>}</div>
        <input ref={picker} type="file" accept=".md,.txt,text/plain,text/markdown" className="visually-hidden" aria-label="选择稿件" onChange={event => { const chosen = event.target.files?.[0]; if (chosen) void upload(chosen).catch(() => undefined); event.target.value = ''; }}/>
        <div className={`upload-box ${!current ? 'unavailable' : ''}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const chosen = event.dataTransfer.files[0]; if (chosen && !busy) void upload(chosen).catch(() => undefined); }}>
          <span className="file-icon"><Icon name="export" size={32}/></span><div><strong>{file?.filename ?? '拖入稿件，或选择文件'}</strong><small>{preview?.encoding ?? (current ? '先预览拆章，再确认导入' : '请先打开或新建作品')}</small></div>
          <Button disabled={!current || busy} onClick={() => picker.current?.click()}>{file ? '重新选择' : '选择稿件'}</Button>
        </div>
        <p className="muted">支持 Markdown 和 TXT，最大 8 MiB。</p>
        <div className="divider"/><h2>拆章预览</h2>
        {preview ? <><div className="table-scroll"><table><thead><tr><th>章节</th><th>标题</th><th className="numeric">字数</th></tr></thead><tbody>{preview.chapters.map((chapter, index) => <tr key={index}><td>{String(index + 1).padStart(2, '0')}</td><td>{chapter.title}</td><td className="numeric">{chapter.characters.toLocaleString()}</td></tr>)}</tbody></table></div><div className="import-summary"><Banner tone={preview.duplicate ? 'amber' : 'green'}>{preview.duplicate ? '内容已导入，不会重复添加。' : '未发现重复导入'}</Banner><span>共 {preview.chapters.length} 章 · {preview.chapters.reduce((sum, c) => sum + c.characters, 0).toLocaleString()} 字</span></div></> : <div className="empty-preview">选择稿件后，在这里核对拆分出的章节。</div>}
        <div className="import-actions"><p className="muted">确认后写入当前作品，保留原始稿件。</p><Button disabled={!file || busy} onClick={() => { setFile(null); setPreview(null); }}>取消导入</Button><Button variant="primary" disabled={!preview || !file || preview.duplicate || busy} onClick={() => { if (current && file && preview) void perform(async () => { await api.post(workspacePath(current.id, 'import'), { ...file, apply: true, expectedVersion: preview.version }); await refresh(); setFile(null); setPreview(null); notify('稿件已导入正式章节。'); }).catch(() => undefined); }}>确认导入{preview ? ` ${preview.chapters.length} 章` : ''}</Button></div>
      </Panel>
    </div>
    {modal && <Dialog title={modal === 'create' ? '新建作品' : '打开工作区'} onClose={() => setModal(null)}><form onSubmit={event => { event.preventDefault(); void save().catch(() => undefined); }}>{modal === 'create' && <Field label="作品名称"><input autoFocus required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：雾港来信"/></Field>}<Field label="作品文件夹" hint="填写启动时指定作品目录内的文件夹名称。"><input autoFocus={modal === 'open'} required value={directory} onChange={e => setDirectory(e.target.value)} placeholder="例如：harbor-letters"/></Field><div className="dialog-actions"><Button onClick={() => setModal(null)}>取消</Button><Button type="submit" variant="primary" disabled={busy}>{modal === 'create' ? '创建作品' : '打开作品'}</Button></div></form></Dialog>}
  </>;
}
