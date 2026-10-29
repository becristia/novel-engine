import { useEffect, useState } from 'react';
import type { Reference, Review } from '../../src/domain/review.js';
import type { ContextSnapshot } from '../../src/context/builder.js';
import { Badge, Banner, Button, Dialog, Empty, ErrorText, Field, Icon, PageHeader, Tabs } from '../components.js';
import { chapterCandidates, chapterCatalog } from '../chapters.js';
import { modelReady, workspacePath } from '../model.js';
import type { PageProps, RevisionView } from '../model.js';
import { useResource, useUnsavedChanges } from '../hooks.js';
import { ContextList, Manuscript, SourceDialog } from '../reading.js';

const issueLabels = { conflict: '确定冲突', uncertain: '待核查', style: '风格建议' };
const issueTones = { conflict: 'red', uncertain: 'amber', style: 'neutral' } as const;
export function ChaptersPage(props: PageProps) {
  const { data, config, busy, action, job, navigate, notify, focus } = props;
  const catalog = chapterCatalog(data);
  const defaultChapter = catalog.find(chapter => chapterCandidates(data, chapter.id).some(item => item.proposal.status === 'pending' && !item.proposal.stale)) ?? catalog.find(chapter => !chapter.revisionId) ?? catalog[0];
  const chapter = catalog.find(item => item.id === focus.chapterId) ?? defaultChapter;
  const candidates = chapter ? chapterCandidates(data, chapter.id) : [];
  const latest = candidates.findLast(item => item.proposal.status === 'pending' && !item.proposal.stale);
  const [candidateId, setCandidateId] = useState(''); const [mode, setMode] = useState('candidate');
  const selected = candidates.find(item => item.revisionId === candidateId) ?? latest ?? candidates.at(-1);
  const revisionId = mode === 'candidate' ? selected?.revisionId : chapter?.revisionId;
  const [pane, setPane] = useState('review'); const [issueId, setIssueId] = useState(''); const [reason, setReason] = useState(''); const [instruction, setInstruction] = useState('');
  const [source, setSource] = useState<Reference | null>(null);
  const [editor, setEditor] = useState<{ chapterId: string | null; title: string; content: string; original: string; version: number; preview: boolean } | null>(null);
  const [reviseOnce, setReviseOnce] = useState(false);
  useUnsavedChanges(Boolean(editor && (editor.content !== editor.original || (!editor.chapterId && editor.title))));
  useEffect(() => {
    const requested = candidates.find(item => item.revisionId === focus.revisionId);
    setCandidateId(requested?.revisionId ?? latest?.revisionId ?? candidates.at(-1)?.revisionId ?? '');
    setMode(requested || latest ? 'candidate' : chapter?.revisionId ? 'official' : 'candidate');
    setIssueId(''); setReason(''); setInstruction('');
  }, [chapter?.id, latest?.revisionId, focus.revisionId]);
  useEffect(() => { if (focus.createChapter) setEditor({ chapterId: null, title: '', content: '', original: '', version: data.project.version, preview: false }); }, [focus.createChapter]);
  const reader = useResource<RevisionView>(revisionId ? workspacePath(data.project.id, `revisions/${revisionId}`) : null, `${data.project.version}:${data.runs.filter(run => run.status === 'running').length}:${data.runs.filter(run => run.status === 'succeeded' || run.status === 'awaiting_approval').length}`);
  const context = useResource<ContextSnapshot>(pane === 'context' && chapter?.plan ? workspacePath(data.project.id, `context?chapter=${chapter.plan.ordinal}`) : null, data.project.version);
  const report = reader.value?.review;
  const issues = [...(report?.payload?.issues ?? [])].sort((a, b) => ['conflict', 'uncertain', 'style'].indexOf(a.kind) - ['conflict', 'uncertain', 'style'].indexOf(b.kind));
  const issue = issues.find(item => item.id === issueId) ?? issues[0];
  const reference = issue?.evidence.find(item => item.revisionId === revisionId);
  const candidate = mode === 'candidate' ? selected?.proposal : null;
  const editableCandidate = candidate?.status === 'pending' && !candidate.stale && !data.runs.find(run => run.id === candidate.runId)?.cancelled;
  const activeModel = data.runs.some(run => run.active);
  const canModel = modelReady(config) && !activeModel && !busy;
  const chapterLocks = data.snapshot.state.locks.filter(lock => lock.chapterId === chapter?.id);
  const previousMissing = chapter?.plan && Object.values(data.snapshot.state.plans).some(plan => plan.ordinal < chapter.plan!.ordinal && !data.snapshot.state.chapters.some(item => item.id === plan.chapterId));
  const canWrite = canModel && Boolean(chapter?.plan) && !previousMissing && !chapterLocks.length;
  const runModel = async (kind: 'write' | 'review' | 'revise') => {
    if (!chapter) return;
    if (kind === 'write' && chapter.plan) await job({ kind: 'write', chapter: chapter.plan.ordinal, reviseOnce });
    if (kind === 'review' && revisionId) await job({ kind: 'review', revisionId });
    if (kind === 'revise' && revisionId) await job({ kind: 'revise', revisionId, instruction });
    notify('任务已启动，结果会自动显示。');
  };
  const closeEditor = () => { if (!editor || editor.content === editor.original || window.confirm('有未保存的正文，确定放弃这次编辑吗？')) setEditor(null); };
  const editDialog = editor && <Dialog title={editor.chapterId ? '编辑正式稿' : '新增正式章节'} onClose={closeEditor}>
    <Banner>保存会创建新的正式版本，相关派生记忆需要重新核对。</Banner>
    {!editor.chapterId && <Field label="章节标题"><input value={editor.title} onChange={e => setEditor({ ...editor, title: e.target.value })}/></Field>}
    {editor.preview ? <div className="edit-preview"><h3>原正文</h3><pre>{editor.original || '新增章节'}</pre><h3>修改后</h3><pre>{editor.content}</pre></div> : <Field label="正文"><textarea rows={14} value={editor.content} onChange={e => setEditor({ ...editor, content: e.target.value })}/></Field>}
    {editor.version !== data.project.version && <Banner tone="red">编辑期间作品版本已经改变，请复制修改内容后重新打开编辑。</Banner>}
    <div className="dialog-actions"><Button onClick={closeEditor}>取消</Button><Button disabled={!editor.content.trim()} onClick={() => setEditor({ ...editor, preview: !editor.preview })}>{editor.preview ? '继续编辑' : '预览差异'}</Button><Button variant="primary" disabled={busy || !editor.preview || !editor.content.trim() || editor.version !== data.project.version || (!editor.chapterId && !editor.title.trim())} onClick={() => {
      const promise = editor.chapterId ? action({ action: 'replace', chapterId: editor.chapterId, content: editor.content, requestId: crypto.randomUUID() }, editor.version) : action({ action: 'insert', title: editor.title, content: editor.content, position: data.snapshot.state.chapters.length + 1 }, editor.version);
      void promise.then(() => { setEditor(null); notify('已保存为新的正式版本。'); }).catch(() => undefined);
    }}>保存为新版本</Button></div>
  </Dialog>;
  if (!chapter) return <><PageHeader title="章节工作台"/><Empty title="还没有章节" detail="先批准章节计划，或直接添加自己的正文。"><div className="actions-row centered"><Button variant="primary" onClick={() => navigate('planning')}>前往规划</Button><Button onClick={() => setEditor({ chapterId: null, title: '', content: '', original: '', version: data.project.version, preview: false })}>新增章节</Button></div></Empty>{editDialog}</>;
  return <>
    <div className="chapter-layout">
      <div className="reader-column">
        <header className="chapter-header"><p className="breadcrumb">{data.project.title} / 第 {chapter.ordinal} 章</p><div className="row-title"><h1>{chapter.title}</h1><div className="actions-row"><Button icon="clock" onClick={() => navigate('versions', { chapterId: chapter.id })}>查看历史</Button><Button variant="ghost" icon="export" onClick={() => navigate('versions')}>导出</Button></div></div></header>
        <div className="manuscript-toolbar"><div className="segmented"><button className={mode === 'official' ? 'selected' : ''} disabled={!chapter.revisionId} onClick={() => setMode('official')}>正式稿</button><button className={mode === 'candidate' ? 'selected' : ''} disabled={!candidates.length} onClick={() => setMode('candidate')}>候选稿</button></div><Badge tone={mode === 'candidate' ? 'amber' : 'green'}>{mode === 'candidate' ? candidate?.status === 'approved' ? '历史候选 · 已批准' : '候选稿 · 未批准' : '当前正式稿'}</Badge>{mode === 'candidate' && candidates.length > 1 && <select aria-label="候选版本" value={selected?.revisionId ?? ''} onChange={e => setCandidateId(e.target.value)}>{candidates.map((item, index) => <option value={item.revisionId} key={item.revisionId}>候选 {index + 1}{item.proposal.stale ? ' · 旧基线' : ''}</option>)}</select>}</div>
        <div className="reading-paper">
          {reader.error ? <ErrorText error={reader.error}/> : reader.value ? <Manuscript revision={reader.value} title={chapter.title} reference={reference} locked={mode === 'official' ? chapterLocks : []}/> : revisionId ? <p className="muted">正在读取正文…</p> : <Empty title="本章尚未生成" detail={chapter.plan ? '计划已经批准，可以生成候选并审稿。' : '本章没有已批准计划。'}/>}
          <footer className="paper-footer"><span>{mode === 'candidate' ? '候选独立保存 · 正式稿以批准结果为准' : '正在阅读当前正式版本'}</span>{mode === 'official' && reader.value && <Button variant="ghost" icon="edit" disabled={busy || chapterLocks.length > 0} onClick={() => setEditor({ chapterId: chapter.id, title: chapter.title, content: reader.value!.content, original: reader.value!.content, version: data.project.version, preview: false })}>编辑正式稿</Button>}</footer>
        </div>
      </div>
      <aside className="inspector">
        <Tabs items={[{ value: 'review', label: '审稿' }, { value: 'plan', label: '本章计划' }, { value: 'context', label: '上下文' }]} value={pane} onChange={setPane}/>
        <div className="inspector-body">
          {pane === 'review' && <>
            <h2>审稿结果</h2>
            {report?.payload ? <><div className="issue-counts">{(['conflict', 'uncertain', 'style'] as const).map(kind => <Badge key={kind} tone={issueTones[kind]}>{issueLabels[kind]} {issues.filter(item => item.kind === kind).length}</Badge>)}</div>{candidate?.stale && <Banner>当前显示历史审稿，候选基线已经过期。</Banner>}
              {issues.length > 1 && <select aria-label="审稿问题" value={issue?.id ?? ''} onChange={e => setIssueId(e.target.value)}>{issues.map(item => <option value={item.id} key={item.id}>{issueLabels[item.kind]}：{item.message}</option>)}</select>}
              {issue ? <IssueCard issue={issue} targetRevision={revisionId ?? ''} chapterTitles={Object.fromEntries(catalog.map(c => [c.id, `第 ${c.ordinal} 章`]))} onLocate={setSource}/> : <Banner tone="green">{report.payload.summary || '本次审稿未发现问题。'}</Banner>}
            </> : <p className="muted">{report?.status === 'failed' ? '上次审稿未完成，可以重新审稿或查看任务记录。' : '暂无有效审稿报告。'}</p>}
            {editableCandidate && <div className="review-actions">
              {candidate.kind === 'draft' && <Field label="修订要求"><textarea value={instruction} placeholder={issue?.suggestion || '描述希望如何修改本章。'} onChange={e => setInstruction(e.target.value)}/></Field>}
              {candidate.approval.requiresReason && <Field label="作者处理理由" hint="说明如何处理待核查或风格意见。"><textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="例如：保留当前节奏作为后文铺垫。"/></Field>}
              <div className="actions-row">{candidate.kind === 'draft' && <Button variant="primary" disabled={!canModel || !instruction.trim() || chapterLocks.length > 0} onClick={() => void runModel('revise').catch(() => undefined)}>修订候选稿</Button>}<Button disabled={!canModel} onClick={() => void runModel('review').catch(() => undefined)}>{report?.payload ? '重新审稿' : '审稿候选稿'}</Button><Button disabled={busy} onClick={() => void action({ action: 'reject', proposalId: candidate.id }).then(() => notify('候选已拒绝，正式稿保持原样。')).catch(() => undefined)}>拒绝候选</Button></div>
              <Button className="wide" variant="primary" disabled={busy || !candidate.approval.canApprove || (candidate.approval.requiresReason && !reason.trim())} onClick={() => void action({ action: 'approve', proposalId: candidate.id, reason }).then(() => { notify('候选已批准为正式稿。'); navigate('chapters', { chapterId: chapter.id }); }).catch(() => undefined)}>批准为正式稿</Button>
              {!candidate.approval.canApprove && <p className="help-text">{candidate.approval.blockedReason}</p>}
            </div>}
            {candidate && !editableCandidate && <Banner>{candidate.stale && candidate.status === 'pending' ? '候选已过期，请在当前版本重新生成。' : '这份候选已处理，保留为历史记录。'}</Banner>}
            <details className="generate-section" open={!revisionId}><summary>{revisionId ? '更多生成选项' : '生成本章'}</summary><Button className="wide" variant={!revisionId ? 'primary' : 'secondary'} disabled={!canWrite} onClick={() => void runModel('write').catch(() => undefined)}>{chapter.revisionId || candidates.length ? '生成新候选并审稿' : '生成并审稿'}</Button><label className="check-label"><input type="checkbox" checked={reviseOnce} onChange={e => setReviseOnce(e.target.checked)}/>允许最多自动修订一次</label>
              {!chapter.plan ? <p className="help-text">本章没有已批准计划；可手工编辑正式稿，或在规划页安排后续章节。</p> : previousMissing ? <p className="help-text">前序章节还没有正式稿，批准后才能继续。</p> : chapterLocks.length ? <p className="help-text">本章含锁定段落，请使用局部改稿。</p> : !modelReady(config) ? <p className="help-text">请先配置创作模型或离线响应文件。</p> : activeModel ? <p className="help-text">本作品有模型任务正在执行。</p> : null}
            </details>
          </>}
          {pane === 'plan' && (chapter.plan ? <div className="stack"><h2>{chapter.plan.title}</h2><Badge tone="green">计划已批准</Badge><div><h3>本章目标</h3><p>{chapter.plan.goal}</p></div><div><h3>出场人物</h3><p>{chapter.plan.characters.join('、') || '未指定'}</p></div><div><h3>关键事件</h3>{chapter.plan.events.map((event, i) => <p key={i}>{i + 1}．{event}</p>)}</div><div><h3>本章约束</h3><p>{chapter.plan.constraints.join('；') || '暂无'}</p></div><p className="help-text">目标 {chapter.plan.targetLength.toLocaleString()} 字；视角：{chapter.plan.viewpointCharacter || '未指定'}。</p></div> : <p className="muted">导入或手工添加的章节没有模型规划记录。</p>)}
          {pane === 'context' && (context.error ? <ErrorText error={context.error}/> : context.value ? <ContextList context={context.value}/> : <p className="muted">{chapter.plan ? '正在读取上下文…' : '需要已批准的章节计划才能预览上下文。'}</p>)}
        </div>
        <footer className="step-strip"><span><Icon name={revisionId ? 'check' : 'clock'} size={18}/>{revisionId ? '正文已保存' : '等待生成'}</span><span>→</span><span><Icon name={report?.payload ? 'check' : 'clock'} size={18}/>{report?.payload ? '审稿完成' : '等待审稿'}</span><span>→</span><span>{mode === 'official' ? '正式稿' : '作者处理'}</span></footer>
      </aside>
    </div>
    {source && <SourceDialog workspace={data.project.id} reference={source} onClose={() => setSource(null)}/>}{editDialog}
  </>;
}

function IssueCard({ issue, targetRevision, chapterTitles, onLocate }: { issue: Review['issues'][number]; targetRevision: string; chapterTitles: Record<string, string>; onLocate: (reference: Reference) => void }) {
  return <section className="issue-card"><h2>{issue.message}</h2>{issue.evidence.map((evidence, index) => <div className="evidence" key={index}><strong>{evidence.revisionId === targetRevision ? '当前候选' : '引用来源'} · {chapterTitles[evidence.chapterId] ?? '来源章节'}</strong><blockquote className={evidence.revisionId === targetRevision ? 'target' : ''}>“{evidence.quote}”</blockquote><button type="button" className="link-button" onClick={() => onLocate(evidence)}><Icon name="file" size={16}/> 定位原文</button></div>)}<div className="divider"/><h3>建议修改</h3><p>{issue.suggestion}</p></section>;
}
