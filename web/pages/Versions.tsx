import { useEffect, useState } from 'react';
import type { Snapshot } from '../../src/domain/workspace.js';
import { Badge, Banner, Button, Dialog, Empty, ErrorText, Field, Icon, PageHeader, Panel } from '../components.js';
import { api } from '../api.js';
import { useResource } from '../hooks.js';
import { Manuscript } from '../reading.js';
import { workspacePath } from '../model.js';
import type { PageProps, RevisionView } from '../model.js';

export function VersionsPage({ data, focus, busy, action, perform, notify }: PageProps) {
  const [version, setVersion] = useState(data.project.version); const [chapterId, setChapterId] = useState(focus.chapterId ?? '');
  const [format, setFormat] = useState<'markdown' | 'txt'>('markdown'); const [filename, setFilename] = useState(''); const [restore, setRestore] = useState(false);
  const snapshot = useResource<Snapshot>(workspacePath(data.project.id, `snapshot?version=${version}`));
  const chapter = snapshot.value?.state.chapters.find(item => item.id === chapterId) ?? snapshot.value?.state.chapters[0];
  const revision = useResource<RevisionView>(chapter ? workspacePath(data.project.id, `revisions/${chapter.revisionId}`) : null);
  const current = data.snapshot.state.chapters.find(item => item.id === chapter?.id);
  const currentRevision = useResource<RevisionView>(restore && current ? workspacePath(data.project.id, `revisions/${current.revisionId}`) : null);
  const locked = data.snapshot.state.locks.some(lock => lock.chapterId === chapter?.id);
  useEffect(() => setFilename(`${data.project.title}-v${version}.${format === 'markdown' ? 'md' : 'txt'}`), [version, format, data.project.title]);
  useEffect(() => { if (focus.chapterId) setChapterId(focus.chapterId); }, [focus.chapterId]);
  const canRestore = Boolean(current && revision.value && current.revisionId !== revision.value.id && !locked && !busy);
  const [restoreBase, setRestoreBase] = useState(data.project.version);
  const move = (id: string, offset: number) => {
    const ids = data.snapshot.state.chapters.map(chapter => chapter.id); const index = ids.indexOf(id); const target = index + offset;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void action<Snapshot>({ action: 'reorder', chapterIds: ids }).then(result => { setVersion(result.version); notify('章节顺序已保存为新版本，相关记忆已失效。'); }).catch(() => undefined);
  };
  return <>
    <PageHeader title="版本与导出" subtitle="查看历史正式稿，选择版本导出。" actions={<Badge tone="amber">当前正式版本 {data.project.version}</Badge>}/>
    <div className="versions-layout">
      <Panel title="作品版本" className="version-history"><div className="version-list">{data.versions.map(item => <button key={item.version} aria-label={`查看作品版本 ${item.version}`} className={version === item.version ? 'selected' : ''} onClick={() => setVersion(item.version)}><span><strong>版本 {item.version}</strong>{item.version === data.project.version && <Badge tone="green">当前版本</Badge>}</span><small>{new Date(item.createdAt).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })}</small><Icon name="arrow" size={17}/></button>)}</div>
        <details className="chapter-order"><summary>调整当前章节顺序</summary><p className="help-text">选择当前版本后调整顺序，会创建新版本。</p>{data.snapshot.state.chapters.map((item, index) => <div key={item.id}><span>{index + 1}．{item.title}</span><button type="button" aria-label={`上移 ${item.title}`} disabled={busy || version !== data.project.version || index === 0} onClick={() => move(item.id, -1)}>↑</button><button type="button" aria-label={`下移 ${item.title}`} disabled={busy || version !== data.project.version || index === data.snapshot.state.chapters.length - 1} onClick={() => move(item.id, 1)}>↓</button></div>)}</details>
      </Panel>
      <Panel className="version-reader"><Banner tone={version === data.project.version ? 'neutral' : 'amber'}>{version === data.project.version ? '当前正式稿' : '历史快照'} · 作品版本 {version} · 只读</Banner>
        <select aria-label="历史章节" value={chapter?.id ?? ''} disabled={!snapshot.value?.state.chapters.length} onChange={e => setChapterId(e.target.value)}>{snapshot.value?.state.chapters.map((item, index) => <option key={item.id} value={item.id}>第 {index + 1} 章 · {item.title}</option>)}</select>
        <div className="version-paper">{snapshot.error || revision.error ? <ErrorText error={snapshot.error ?? revision.error}/> : revision.value && chapter ? <Manuscript revision={revision.value} title={chapter.title} locked={snapshot.value?.state.locks.filter(lock => lock.chapterId === chapter.id) ?? []}/> : <Empty title={snapshot.loading ? '正在读取历史版本' : '该版本尚无正式稿'}/>}</div>
        <div className="restore-bar"><Button disabled={!canRestore} onClick={() => { setRestoreBase(data.project.version); setRestore(true); }}>预览恢复此章</Button><span className="help-text">{locked ? '当前章节有锁定段落，需要先处理锁定。' : '恢复会创建新版本，历史记录仍保留。'}</span></div>
      </Panel>
      <Panel className="export-panel"><h2>导出设置</h2><div className="export-version"><strong>作品版本 {version}</strong><small>{version === data.project.version ? '当前正式版本' : '选中的历史快照'}</small></div><div className="divider"/><h3>文件格式</h3><label className="radio-label"><input type="radio" name="export-format" checked={format === 'markdown'} onChange={() => setFormat('markdown')}/>Markdown (.md)</label><label className="radio-label"><input type="radio" name="export-format" checked={format === 'txt'} onChange={() => setFormat('txt')}/>TXT (.txt)</label><div className="divider"/><h3>导出范围</h3><p className="export-scope">整部作品 · {snapshot.value?.state.chapters.length ?? 0} 章正式稿</p><div className="divider"/>
        <Field label="文件名"><input value={filename} onChange={e => setFilename(e.target.value)}/></Field><Banner>只包含选中版本的正式稿。</Banner><Button className="wide" variant="primary" disabled={busy || !snapshot.value?.state.chapters.length || !filename.trim()} onClick={() => void perform(async () => { await api.download(workspacePath(data.project.id, `export?version=${version}&format=${format}`), filename.trim()); notify(`已发起版本 ${version} 的下载。`); }).catch(() => undefined)}>导出版本 {version}</Button><div className="divider"/><p className="export-check"><Icon name="check"/>章节顺序固定</p><p className="export-check"><Icon name="check"/>正文与历史版本一致</p>
      </Panel>
    </div>
    {restore && revision.value && chapter && <Dialog title="恢复章节为新版本" onClose={() => setRestore(false)}><Banner>将以选中的历史正文创建新正式版本，相关派生记忆会失效。</Banner>{currentRevision.value ? <div className="edit-preview"><h3>当前正文</h3><pre>{currentRevision.value.content}</pre><h3>恢复后</h3><pre>{revision.value.content}</pre></div> : currentRevision.error ? <ErrorText error={currentRevision.error}/> : <p>正在读取当前正文…</p>}{restoreBase !== data.project.version && <Banner tone="red">作品已经更新，请重新预览后再恢复。</Banner>}<div className="dialog-actions"><Button onClick={() => setRestore(false)}>取消</Button><Button variant="primary" disabled={busy || !currentRevision.value || restoreBase !== data.project.version || locked} onClick={() => void action<Snapshot>({ action: 'restore', chapterId: chapter.id, revisionId: revision.value!.id }, restoreBase).then(result => { setRestore(false); setVersion(result.version); notify('已通过新版本恢复历史正文。'); }).catch(() => undefined)}>确认恢复为新版本</Button></div></Dialog>}
  </>;
}
