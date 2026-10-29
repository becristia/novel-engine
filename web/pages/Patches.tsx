import { useEffect, useState } from 'react';
import { SelectionSchema } from '../../src/domain/patch.js';
import type { PatchService } from '../../src/proposals/patches.js';
import type { Proposal } from '../../src/storage/proposal-store.js';
import type { Snapshot } from '../../src/domain/workspace.js';
import type { Reference } from '../../src/domain/review.js';
import { Badge, Banner, Button, Dialog, Empty, ErrorText, Field, Icon, PageHeader, Panel } from '../components.js';
import { api } from '../api.js';
import { modelReady, workspacePath } from '../model.js';
import type { PageProps, RevisionView } from '../model.js';
import { useResource } from '../hooks.js';
import { SourceDialog } from '../reading.js';

type Preview = ReturnType<PatchService['preview']>;
const groupKey = (ids: string[]) => JSON.stringify([...ids].sort());
export function PatchesPage({ data, config, busy, focus, action, job, notify, navigate, budget }: PageProps) {
  const latest = data.patches.findLast(item => item.status === 'pending' && item.baseVersion === data.project.version) ?? data.patches.at(-1);
  const [patchId, setPatchId] = useState(focus.proposalId ?? latest?.id ?? '');
  const patch = data.patches.find(item => item.id === patchId) ?? latest;
  const associated = data.proposals.filter(item => item.kind === 'selection' && SelectionSchema.parse(item.payload).sourceProposalId === patch?.id);
  const [groups, setGroups] = useState<string[]>([]); const [chapterId, setChapterId] = useState('');
  const [instruction, setInstruction] = useState(''); const [sourceChapter, setSourceChapter] = useState(data.snapshot.state.chapters[0]?.id ?? '');
  const [analyze, setAnalyze] = useState(false); const [coverage, setCoverage] = useState(false); const [dependencies, setDependencies] = useState<string[] | null>(null); const [undo, setUndo] = useState(false);
  const [reason, setReason] = useState(''); const [combined, setCombined] = useState(false);
  const [source, setSource] = useState<Reference | null>(null);
  const [preview, setPreview] = useState<{ key: string; value: Preview | null; error: unknown } | null>(null);
  const [reports, setReports] = useState<{ key: string; values: RevisionView[] } | null>(null); const [reportError, setReportError] = useState<unknown>(null);
  useEffect(() => { if (latest) setPatchId(latest.id); }, [latest?.id]);
  useEffect(() => { if (focus.proposalId) setPatchId(focus.proposalId); }, [focus.proposalId]);
  useEffect(() => { const selected = associated.at(-1); setGroups(selected ? SelectionSchema.parse(selected.payload).groupIds : []); setReason(''); setChapterId(''); }, [patch?.id]);
  const selection = associated.findLast(item => groupKey(SelectionSchema.parse(item.payload).groupIds) === groupKey(groups));
  const chosen = selection ? SelectionSchema.parse(selection.payload) : null;
  const previewKey = `${patch?.id}:${groupKey(groups)}:${data.project.version}`;
  useEffect(() => {
    if (!patch || !groups.length) return;
    let active = true;
    void api.post<Preview>(workspacePath(data.project.id, 'preview'), { proposalId: patch.id, groups }).then(value => { if (active) setPreview({ key: previewKey, value, error: null }); }).catch(error => { if (active) setPreview({ key: previewKey, value: null, error }); });
    return () => { active = false; };
  }, [previewKey]);
  const result = groups.length && preview?.key === previewKey ? preview.value : null;
  const previewError = groups.length && preview?.key === previewKey ? preview.error : null;
  const selectedChapter = result?.changes.find(item => item.chapterId === chapterId) ?? result?.changes[0];
  const reportKey = `${selection?.id}:${data.project.version}:${data.runs.map(run => `${run.id}:${run.status}`).join('|')}`;
  useEffect(() => {
    if (!chosen) return;
    let active = true; setReportError(null);
    void Promise.all(chosen.drafts.map(draft => api.get<RevisionView>(workspacePath(data.project.id, `revisions/${draft.revisionId}`)))).then(values => { if (active) setReports({ key: reportKey, values }); }).catch(error => { if (active) setReportError(error); });
    return () => { active = false; };
  }, [reportKey]);
  const audited = (id: string) => {
    const revision = reports?.key === reportKey ? reports.values.find(item => item.id === id) : null;
    return Boolean(revision?.review?.payload && revision.review.baseVersion === selection?.baseVersion && revision.extraction?.payload && revision.extraction.baseVersion === selection?.baseVersion);
  };
  const auditedCount = chosen?.drafts.filter(draft => audited(draft.revisionId)).length ?? 0;
  const stale = Boolean(patch && (patch.baseVersion !== data.project.version || patch.status !== 'pending'));
  const baseSnapshot = useResource<Snapshot>(patch && patch.baseVersion !== data.project.version ? workspacePath(data.project.id, `snapshot?version=${patch.baseVersion}`) : null);
  const sourceLocks = patch?.baseVersion === data.project.version ? data.snapshot.state.locks : baseSnapshot.value?.state.locks ?? [];
  const canModel = modelReady(config) && !busy && !data.runs.some(run => run.active);
  const canUndo = Boolean(selection?.status === 'approved' && chosen?.drafts.every(draft => data.snapshot.state.chapters.some(chapter => chapter.id === draft.chapterId && chapter.revisionId === draft.revisionId)));
  const titleFor = (id: string) => data.snapshot.state.chapters.find(item => item.id === id)?.title ?? '来源章节';
  const numberFor = (id: string) => data.snapshot.state.chapters.findIndex(item => item.id === id) + 1;
  const groupTitle = (id: string) => `${String((patch?.payload.groups.findIndex(group => group.id === id) ?? -1) + 1).padStart(2, '0')}`;
  const toggle = (id: string) => {
    if (groups.includes(id)) { setGroups(groups.filter(group => group !== id)); return; }
    const required = new Set<string>();
    const visit = (current: string) => { if (required.has(current)) return; required.add(current); patch?.payload.groups.find(item => item.id === current)?.dependsOn.forEach(visit); };
    visit(id); const missing = [...required].filter(item => !groups.includes(item));
    if (missing.length > 1) setDependencies(missing); else setGroups([...groups, id]);
  };
  const generator = <form onSubmit={event => { event.preventDefault(); void job({ kind: 'impact', chapterId: sourceChapter, instruction }).then(() => { setAnalyze(false); notify('改稿影响分析已启动。'); }).catch(() => undefined); }}><Field label="修改起点"><select value={sourceChapter} required onChange={e => setSourceChapter(e.target.value)}>{data.snapshot.state.chapters.map((chapter, index) => <option key={chapter.id} value={chapter.id}>第 {index + 1} 章 · {chapter.title}</option>)}</select></Field><Field label="修改要求"><textarea required rows={5} value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="例如：把林舟得知父亲身份的时间推迟到第六章。"/></Field><p className="help-text">本次最多 {budget.maxRequests} 次请求，{budget.maxTokens.toLocaleString()} token。</p>{!modelReady(config) && <Banner>请先配置创作模型或离线响应。</Banner>}<div className="dialog-actions"><Button type="submit" variant="primary" disabled={!canModel || !sourceChapter || !instruction.trim()}>分析改稿影响</Button></div></form>;
  return <>
    <PageHeader title="局部改稿" actions={<Button disabled={!data.snapshot.state.chapters.length || busy} onClick={() => setAnalyze(true)}>新建改稿要求</Button>}/>
    {!patch ? <div className="planning-start"><Panel title="分析改稿影响">{generator}</Panel><Empty title="从一处修改，核对相关后文" detail="分析之后按修改组预览，选择实际要采用的内容，再逐章审稿。"/></div> : <>
      <div className="impact-brief"><div><strong>修改要求</strong><p>{patch.payload.instruction}</p></div><Badge tone="amber">已检查 {patch.payload.searchedChapterIds.length} 章 · 未检查 {patch.payload.omittedChapterIds.length} 章</Badge><button className="link-button" onClick={() => setCoverage(true)}>查看检查范围</button></div>
      {data.patches.length > 1 && <select className="patch-selector" aria-label="修改方案" value={patch.id} onChange={e => setPatchId(e.target.value)}>{data.patches.map((item, index) => <option key={item.id} value={item.id}>方案 {index + 1} · {item.baseVersion === data.project.version && item.status === 'pending' ? '当前基线' : '历史方案'}</option>)}</select>}
      {stale && <Banner>此方案基于旧作品版本；新的修改需要重新分析。<Button variant="ghost" disabled={!canModel} onClick={() => void job({ kind: 'revalidate', proposalId: patch.id }).then(() => notify('正在基于当前正式稿重新分析。')).catch(() => undefined)}>重新分析剩余修改</Button></Banner>}
      <div className="patch-layout"><Panel title="修改组" className="patch-groups"><div className="stack">{patch.payload.groups.map((group, index) => <label key={group.id} className={`group-card ${groups.includes(group.id) ? 'selected' : ''}`}><input type="checkbox" aria-label={`选择修改组 ${String(index + 1).padStart(2, '0')}`} checked={groups.includes(group.id)} disabled={stale || busy} onChange={() => toggle(group.id)}/><span><strong>{String(index + 1).padStart(2, '0')}　{group.reason}</strong><small>{[...new Set(group.changes.map(change => `第 ${numberFor(change.target.chapterId)} 章`))].join('、')}{group.dependsOn.length > 0 && ` · 依赖修改组 ${group.dependsOn.map(groupTitle).join('、')}`}</small></span></label>)}</div>{!patch.payload.groups.length && <p className="muted">本次分析没有提出修改组。</p>}<p className="panel-foot">已选 {groups.length} 组 · 涉及 {result?.changes.length ?? 0} 章</p></Panel>
        <Panel className="diff-panel"><div className="row-title"><div className="diff-title">{result && result.changes.length > 1 ? <select aria-label="差异章节" value={selectedChapter?.chapterId ?? ''} onChange={e => setChapterId(e.target.value)}>{result.changes.map(change => <option key={change.chapterId} value={change.chapterId}>第 {numberFor(change.chapterId)} 章 · {titleFor(change.chapterId)}</option>)}</select> : <h2>{selectedChapter ? `第 ${numberFor(selectedChapter.chapterId)} 章 · ${titleFor(selectedChapter.chapterId)}` : '所选修改预览'}</h2>}</div><div className="segmented compact"><button className={!combined ? 'selected' : ''} onClick={() => setCombined(false)}>并排对比</button><button className={combined ? 'selected' : ''} onClick={() => setCombined(true)}>合并对比</button></div></div>
          {previewError ? <ErrorText error={previewError}/> : selectedChapter ? <div className={`diff-columns ${combined ? 'combined' : ''}`}><DiffColumn title={stale ? '方案基线正文' : '当前正式稿'} content={selectedChapter.before} change={selectedChapter} after={false} locks={sourceLocks.filter(lock => lock.chapterId === selectedChapter.chapterId && lock.revisionId === selectedChapter.baseRevisionId)}/><DiffColumn title="所选修改预览" content={selectedChapter.after} change={selectedChapter} after locks={sourceLocks.filter(lock => lock.chapterId === selectedChapter.chapterId && lock.revisionId === selectedChapter.baseRevisionId)}/></div> : <Empty title={groups.length ? '正在计算实际结果' : '选择修改组'} detail="预览只包含当前勾选的内容。"/>}
        </Panel>
        <Panel className="impact-panel"><h2>影响与下一步</h2><div className="impact-count"><span>直接冲突</span><strong className="error-text">{patch.payload.impacts.filter(item => item.kind === 'direct-conflict').length}</strong></div><div className="impact-count"><span>因果待核查</span><strong className="attention-text">{patch.payload.impacts.filter(item => item.kind === 'causal-check').length}</strong></div><div className="divider"/><h3>依赖关系</h3>{patch.payload.groups.filter(group => groups.includes(group.id) && group.dependsOn.length).map(group => <p className="dependency-row" key={group.id}>修改组 {groupTitle(group.id)} → {group.dependsOn.map(groupTitle).join('、')}</p>)}{patch.payload.omittedChapterIds.length > 0 && <Banner>未检查章节仍需核对。</Banner>}
          <div className="divider"/><h3>后续步骤</h3><ol className="next-steps"><li>生成所选候选</li><li>逐章重新审稿</li><li>作者批准</li></ol><p className="help-text">只选部分修改，也需要对实际结果重新审稿。</p>
          <details><summary>查看影响证据</summary>{patch.payload.impacts.map((impact, index) => <div className="impact-evidence" key={index}><strong>{titleFor(impact.chapterId)}</strong><p>{impact.explanation}</p>{impact.evidence.map((reference, i) => <div key={i}><blockquote>“{reference.quote}”</blockquote><button className="link-button" onClick={() => setSource(reference)}>定位原文</button></div>)}</div>)}</details>
        </Panel></div>
      {selection && chosen && <Panel className="selection-review"><div className="row-title"><h2>所选候选 · 已审稿 {auditedCount}／{chosen.drafts.length} 章</h2><Badge tone={selection.status === 'approved' ? 'green' : 'amber'}>{selection.status === 'approved' ? '已批准' : selection.stale ? '旧基线' : selection.status === 'rejected' ? '已拒绝' : '等待审稿与批准'}</Badge></div>{reportError ? <ErrorText error={reportError}/> : null}<div className="selection-chapters">{chosen.drafts.map(draft => <div key={draft.revisionId}><strong>第 {numberFor(draft.chapterId)} 章 · {titleFor(draft.chapterId)}</strong><Badge tone={audited(draft.revisionId) ? 'green' : 'amber'}>{audited(draft.revisionId) ? '已审稿' : '待审稿'}</Badge><Button variant="ghost" onClick={() => navigate('chapters', { chapterId: draft.chapterId, revisionId: draft.revisionId })}>查看候选</Button><Button disabled={!canModel || selection.stale || selection.status !== 'pending'} onClick={() => void job({ kind: 'review', revisionId: draft.revisionId }).then(() => notify('正在审稿所选修改的实际结果。')).catch(() => undefined)}>审稿第 {numberFor(draft.chapterId)} 章</Button></div>)}</div>
        {selection.approval.requiresReason && selection.status === 'pending' && <Field label="作者处理理由"><textarea value={reason} onChange={e => setReason(e.target.value)}/></Field>}
        {selection.status === 'pending' && !selection.approval.canApprove && <p className="help-text">{selection.approval.blockedReason}</p>}
      </Panel>}
      <div className="action-bar"><span>已选 {groups.length} 组 · 涉及 {result?.changes.length ?? 0} 章</span><div className="actions-row">{selection?.status === 'approved' ? <Button disabled={!canUndo || busy} onClick={() => setUndo(true)}>预览撤回所选方案</Button> : selection ? <Button variant="primary" disabled={busy || !selection.approval.canApprove || auditedCount !== chosen?.drafts.length || (selection.approval.requiresReason && !reason.trim())} onClick={() => void action({ action: 'approve', proposalId: selection.id, reason }).then(() => notify('所选方案已一次性写入正式稿。')).catch(() => undefined)}>批准所选方案</Button> : <Button variant="primary" disabled={busy || stale || !result || Boolean(previewError) || !groups.length} onClick={() => void action<Proposal>({ action: 'select-patch', proposalId: patch.id, groups }).then(() => notify('所选候选已保存，请逐章重新审稿。')).catch(() => undefined)}>生成所选候选</Button>}</div></div>
      {selection?.status === 'approved' && !canUndo && <p className="help-text">相关章节已有后续版本，不能自动撤回覆盖。</p>}
    </>}
    {analyze && <Dialog title="新建改稿要求" onClose={() => setAnalyze(false)}>{generator}</Dialog>}
    {source && <SourceDialog workspace={data.project.id} reference={source} onClose={() => setSource(null)}/>}
    {coverage && patch && <Dialog title="检查范围" onClose={() => setCoverage(false)}><h3>已检查章节</h3>{patch.payload.searchedChapterIds.map(id => <p key={id}>{titleFor(id)}</p>)}<h3>未检查章节</h3>{patch.payload.omittedChapterIds.length ? patch.payload.omittedChapterIds.map(id => <p key={id}>{titleFor(id)}</p>) : <p>没有省略的章节。</p>}<p className="help-text">分析覆盖范围不等于所有因果关系已经核实。</p></Dialog>}
    {dependencies && <Dialog title="同时选择依赖组" onClose={() => setDependencies(null)}><p>这项修改需要以下修改组共同生效：</p>{dependencies.map(id => <p key={id}>修改组 {groupTitle(id)} · {patch?.payload.groups.find(group => group.id === id)?.reason}</p>)}<div className="dialog-actions"><Button onClick={() => setDependencies(null)}>取消</Button><Button variant="primary" onClick={() => { setGroups([...new Set([...groups, ...dependencies])]); setDependencies(null); }}>同时选择依赖组</Button></div></Dialog>}
    {undo && selection && result && <Dialog title="撤回所选方案" onClose={() => setUndo(false)}><Banner>将创建新版本恢复修改前正文，历史记录仍保留。</Banner>{result.changes.map(change => <section className="undo-preview" key={change.chapterId}><h3>{titleFor(change.chapterId)}</h3><strong>恢复后</strong><pre>{change.before}</pre></section>)}<div className="dialog-actions"><Button onClick={() => setUndo(false)}>取消</Button><Button variant="primary" disabled={busy || !canUndo} onClick={() => void action({ action: 'undo', proposalId: selection.id }).then(() => { setUndo(false); notify('已创建新版本撤回所选修改。'); }).catch(() => undefined)}>确认撤回</Button></div></Dialog>}
  </>;
}

function DiffColumn({ title, content, change, after, locks }: { title: string; content: string; change: Preview['changes'][number]; after: boolean; locks: { start: number; end: number }[] }) {
  let displacement = 0;
  const edits = [...change.edits].sort((a, b) => a.start - b.start);
  const ranges = edits.map(edit => { const start = after ? edit.start + displacement : edit.start; const end = after ? start + edit.replacement.length : edit.end; displacement += edit.replacement.length - (edit.end - edit.start); return { start, end, kind: 'change' }; });
  const held = locks.map(lock => { const offset = after ? edits.filter(edit => edit.end <= lock.start).reduce((sum, edit) => sum + edit.replacement.length - (edit.end - edit.start), 0) : 0; return { start: lock.start + offset, end: lock.end + offset, kind: 'lock' }; });
  const heading = /^##[^\n]*\n+/u.exec(content)?.[0].length ?? 0;
  const offset = ranges.some(range => range.start < heading) ? 0 : heading;
  const points = [...new Set([offset, content.length, ...[...ranges, ...held].flatMap(range => [Math.max(offset, range.start), Math.max(offset, range.end)])])].sort((a, b) => a - b);
  return <section className="diff-column"><h3>{title}</h3><div className="diff-text">{points.slice(0, -1).map((start, index) => {
    const end = points[index + 1]!; const changed = ranges.find(range => range.start <= start && range.end >= end); const locked = held.find(range => range.start <= start && range.end >= end); const text = content.slice(start, end);
    return <span key={start} className={changed ? after ? 'diff-added' : 'diff-removed' : locked ? 'diff-locked' : ''}>{changed && <b aria-label={after ? '新增' : '删除'}>{after ? '+' : '−'} </b>}{locked && <small><Icon name="lock" size={14}/> 锁定段落 · 保持原文</small>}{text}</span>;
  })}</div></section>;
}
