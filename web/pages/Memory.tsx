import { useEffect, useState } from 'react';
import { z } from 'zod';
import { FactSchema } from '../../src/domain/review.js';
import type { Reference } from '../../src/domain/review.js';
import type { ContextSnapshot } from '../../src/context/builder.js';
import { DraftPayloadSchema } from '../../src/domain/planning.js';
import { SelectionSchema } from '../../src/domain/patch.js';
import { Badge, Banner, Button, Dialog, Empty, ErrorText, Field, Icon, PageHeader, Panel, Tabs } from '../components.js';
import { ContextList, SourceDialog } from '../reading.js';
import { modelReady, workspacePath } from '../model.js';
import type { PageProps, RevisionView, WorkspaceView } from '../model.js';
import { useResource, useUnsavedChanges } from '../hooks.js';

type Fact = z.infer<typeof FactSchema>;
type Entry = WorkspaceView['memory'][number];
const relations: Record<Fact['relation'], string> = { location: '位于', possession: '持有', identity: '身份为', knowledge: '知道', event: '相关事件：', foreshadow: '相关伏笔：' };
const kinds = { fact: '已发生事实', belief: '角色误信', plan: '未来计划' };
const entryText = (entry: Entry) => entry.fact ? `${entry.fact.subject}${relations[entry.fact.relation]}${entry.fact.value}` : entry.summary?.summary ?? '章节摘要';
export function MemoryPage({ data, config, busy, action, job, notify, budget }: PageProps) {
  const [tab, setTab] = useState('fact'); const [person, setPerson] = useState('all'); const [query, setQuery] = useState(''); const [stateFilter, setStateFilter] = useState('all');
  const [selected, setSelected] = useState(''); const [source, setSource] = useState<Reference | null>(null);
  const [correction, setCorrection] = useState<{ id: string; fact: Fact; original: string; version: number } | null>(null);
  const [editor, setEditor] = useState<{ kind: 'aliases' | 'constraints'; entity: string; originalEntity: string; text: string; original: string; version: number } | null>(null);
  const plans = Object.values(data.snapshot.state.plans).sort((a, b) => a.ordinal - b.ordinal);
  const next = plans.find(plan => !data.snapshot.state.chapters.some(chapter => chapter.id === plan.chapterId)) ?? plans.at(-1);
  const [contextChapter, setContextChapter] = useState(next?.ordinal ?? 0);
  useEffect(() => { if (!contextChapter && next) setContextChapter(next.ordinal); }, [next?.ordinal]);
  const context = useResource<ContextSnapshot>(contextChapter ? workspacePath(data.project.id, `context?chapter=${contextChapter}`) : null, `${data.project.version}:${data.memory.length}:${data.runs.filter(run => run.status === 'succeeded').length}`);
  const correctionSource = useResource<RevisionView>(correction ? workspacePath(data.project.id, `revisions/${correction.fact.evidence.revisionId}`) : null);
  const dirty = Boolean(correction && JSON.stringify(correction.fact) !== correction.original || editor && (editor.text !== editor.original || editor.entity !== editor.originalEntity));
  useUnsavedChanges(dirty);
  const people = [...new Set([...plans.flatMap(plan => plan.characters), ...Object.keys(data.snapshot.state.aliases), ...data.memory.flatMap(entry => entry.fact?.characterId ? [entry.fact.characterId] : [])])];
  const visible = data.memory.filter(entry => {
    const fact = entry.fact; const aliases = data.snapshot.state.aliases[person] ?? [];
    return (tab === 'summary' ? entry.kind === 'summary' : fact?.kind === tab) && (person === 'all' || fact?.subject === person || fact?.characterId === person || Boolean(fact && aliases.includes(fact.subject))) && (stateFilter === 'all' || entry.status === stateFilter) && entryText(entry).includes(query);
  });
  const entry = visible.find(item => item.id === selected) ?? visible[0];
  const reference = entry?.fact?.evidence ?? entry?.summary?.evidence[0];
  const ordinal = (id: string) => { const index = data.snapshot.state.chapters.findIndex(item => item.id === id); return index >= 0 ? index + 1 : data.snapshot.state.plans[id]?.ordinal ?? null; };
  const chapterNumber = entry ? ordinal(entry.sourceChapterId) : null;
  const staleSources = data.memorySources.filter(item => item.status === 'stale').length;
  const staleCount = data.memory.filter(item => item.status === 'stale').length;
  const retired = (item: Entry) => item.status === 'stale' && data.memorySources.some(source => source.revisionId === item.revisionId && source.status === 'fresh');
  const sourceLabel = (item: Entry) => item.status === 'fresh' ? '有效' : item.status === 'pending' ? '候选来源' : retired(item) ? '历史条目' : '已失效';
  const availableCandidate = (item: Entry) => data.proposals.some(proposal => {
    if (proposal.status !== 'pending' || proposal.stale || data.runs.find(run => run.id === proposal.runId)?.cancelled) return false;
    return proposal.kind === 'draft' ? DraftPayloadSchema.parse(proposal.payload).revisionId === item.revisionId : proposal.kind === 'selection' && SelectionSchema.parse(proposal.payload).drafts.some(draft => draft.revisionId === item.revisionId);
  });
  const canConfirm = Boolean(entry?.fact && !entry.confirmed && (entry.status === 'fresh' || entry.status === 'pending' && availableCandidate(entry)));
  const adopted = Boolean(entry?.status === 'fresh' && context.value?.sources.some(item => item.kind === 'fact' ? item.id === entry.id : item.kind === 'summary' && item.revisionId === entry.revisionId && item.text === entry.summary?.summary));
  const omittedReason = !entry ? '' : entry.status === 'stale' ? '信息已失效或被替代' : entry.status === 'pending' ? '候选尚未批准' : entry.fact && !entry.confirmed ? '尚未确认' : '不在本次来源清单中';
  const canModel = modelReady(config) && !busy && !data.runs.some(run => run.active) && data.snapshot.state.chapters.length > 0;
  const rebuild = () => job({ kind: 'memory' }).then(result => notify(result.runId ? '记忆重建已启动，完成后自动刷新。' : '当前正式来源已是最新，无需重建。'));
  const closeDialog = () => { if (!dirty || window.confirm('有未保存的信息，确定放弃这次编辑吗？')) { setCorrection(null); setEditor(null); } };
  return <>
    <PageHeader title="故事记忆"/>
    <Tabs items={[{ value: 'fact', label: '事实' }, { value: 'belief', label: '角色误信' }, { value: 'plan', label: '未来计划' }, { value: 'summary', label: '章节摘要' }]} value={tab} onChange={value => { setTab(value); setSelected(''); }}/>
    <div className="memory-layout">
      <Panel title="人物" className="people-panel"><button className={person === 'all' ? 'selected' : ''} onClick={() => setPerson('all')}>全部人物</button>{people.map(name => <button key={name} className={person === name ? 'selected' : ''} onClick={() => setPerson(name)}>{name}</button>)}<div className="divider"/><p className="help-text">{person === 'all' ? '选择人物查看相关信息。' : `别名：${data.snapshot.state.aliases[person]?.join('、') || '未设置'}`}</p>
        <Button variant="ghost" icon="edit" onClick={() => { const entity = person === 'all' ? people[0] ?? '' : person; const text = (data.snapshot.state.aliases[entity] ?? []).join('，'); setEditor({ kind: 'aliases', entity, originalEntity: entity, text, original: text, version: data.project.version }); }}>管理别名</Button>
        <Button variant="ghost" onClick={() => setEditor({ kind: 'constraints', entity: '', originalEntity: '', text: data.snapshot.state.constraints.join('\n'), original: data.snapshot.state.constraints.join('\n'), version: data.project.version })}>作者约束</Button>
      </Panel>
      <div className="memory-center"><div className="memory-tools"><div className="search-box"><Icon name="search"/><input aria-label="搜索人物、物品或事件" placeholder="搜索人物、物品或事件" value={query} onChange={e => setQuery(e.target.value)}/></div><select aria-label="来源状态筛选" value={stateFilter} onChange={e => setStateFilter(e.target.value)}><option value="all">全部来源</option><option value="fresh">有效来源</option><option value="pending">候选来源</option><option value="stale">失效与历史</option></select></div>
        {staleCount > 0 && <div className="memory-warning"><Badge tone="amber">{staleSources} 个来源 · {staleCount} 条信息失效或归档</Badge><button className="link-button" onClick={() => setStateFilter('stale')}>查看失效项</button></div>}
        <div className="table-scroll memory-table"><table><thead><tr><th>信息</th><th>来源</th><th>作者确认</th><th>来源状态</th></tr></thead><tbody>{visible.map(item => <tr key={item.id} className={`clickable ${item.id === entry?.id ? 'selected' : ''}`} tabIndex={0} onClick={() => setSelected(item.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(item.id); } }}><td>{entryText(item)}</td><td>第 {ordinal(item.sourceChapterId) ?? '？'} 章</td><td>{item.kind === 'summary' ? <span className="muted">派生摘要</span> : <Badge tone={item.confirmed ? 'green' : 'amber'}>{item.confirmed ? '已确认' : '待确认'}</Badge>}</td><td><Badge tone={item.status === 'fresh' ? 'green' : 'amber'}>{sourceLabel(item)}</Badge></td></tr>)}</tbody></table></div>
        {!visible.length && <Empty title="没有符合条件的信息" detail={data.memory.length ? '调整类型、人物或来源筛选后重试。' : '先生成并批准正文，或从已有正式稿提取记忆。'}><Button disabled={!canModel} onClick={() => void rebuild().catch(() => undefined)}>重建章节记忆</Button></Empty>}
      </div>
        <Panel className="memory-context"><div className="row-title"><h2>{contextChapter ? `第 ${contextChapter} 章上下文预览` : '上下文预览'}</h2><select aria-label="上下文章节" value={contextChapter} disabled={!plans.length} onChange={e => setContextChapter(Number(e.target.value))}><option value={0} disabled>选择已批准计划</option>{plans.map(plan => <option key={plan.chapterId} value={plan.ordinal}>第 {plan.ordinal} 章 · {plan.title}</option>)}</select></div>
          {context.error ? <ErrorText error={context.error}/> : context.value ? <><div className="context-summary"><span><Icon name="user" size={18}/>视角：{context.value.plan.viewpointCharacter || '未指定'}</span>{entry && <span className={adopted ? 'success-text' : 'attention-text'}>{adopted ? '当前条目已采用' : `当前条目未采用：${omittedReason}`}</span>}</div><ContextList context={context.value}/></> : <p className="help-text">{contextChapter ? '正在计算实际上下文…' : '需要已批准的章节计划才能预览实际上下文。'}</p>}
        </Panel>
      <Panel className="memory-inspector"><h2>来源与确认</h2>{entry ? <><h3>{entryText(entry)}</h3><div className="actions-row"><Badge>{entry.fact ? kinds[entry.fact.kind] : '章节摘要'}</Badge>{entry.fact && <Badge tone={entry.confirmed ? 'green' : 'amber'}>{entry.confirmed ? '已确认' : '待确认'}</Badge>}</div>
        {reference ? <div className="memory-source"><strong>第 {chapterNumber ?? '？'} 章 · {entry.status === 'pending' ? '候选稿' : '来源正文'}</strong><blockquote>“{reference.quote}”</blockquote><button className="link-button" onClick={() => setSource(reference)}>定位原文</button></div> : <p className="help-text">此摘要没有单独的原句引用。</p>}
        {entry.fact && <><p className="fact-time">故事时间：{entry.fact.storyTime ?? '未知'}</p><p className="fact-time">获知时间：{entry.fact.knowledgeTime ?? '未知'}</p><p className="help-text">来源有效，不代表内容已经由作者确认。</p>
          <Button className="wide" variant="primary" disabled={!canConfirm || busy} onClick={() => void action({ action: 'confirm-facts', ids: [entry.id] }).then(() => notify('信息已确认，来源与上下文状态已刷新。')).catch(() => undefined)}>{entry.confirmed ? '这条信息已确认' : '确认这条信息'}</Button>
          <Button className="wide" disabled={busy || entry.status !== 'fresh'} onClick={() => setCorrection({ id: entry.id, fact: structuredClone(entry.fact!), original: JSON.stringify(entry.fact), version: data.project.version })}>纠正信息</Button>
          <p className="help-text">{entry.status === 'pending' ? '候选事实确认不会批准正文。' : entry.status === 'stale' ? '历史或失效条目只读，请核对当前来源。' : '确认或纠正会更新作品版本，现有候选可能需要重新生成。'}</p>
        </>}
        {entry.parentId && <button className="link-button" onClick={() => { const parent = data.memory.find(item => item.id === entry.parentId); if (parent) { setPerson('all'); setStateFilter('all'); setQuery(''); setTab(parent.fact?.kind ?? 'summary'); setSelected(parent.id); } }}>作者纠正 · 查看原条目</button>}
      </> : <p className="muted">选择一条信息，核对它的原文来源。</p>}
        <div className="divider"/><div className="row-title"><h3>来源更新</h3><Badge>调用模型</Badge></div><p className="help-text">最多 {budget.maxRequests} 次请求，{budget.maxTokens.toLocaleString()} token。只处理缺少或失效的正式来源。</p><Button className="wide" disabled={!canModel} onClick={() => void rebuild().catch(() => undefined)}>{staleSources ? '重建失效来源' : '重建章节记忆'}</Button>
      </Panel>
    </div>
    {source && <SourceDialog workspace={data.project.id} reference={source} onClose={() => setSource(null)}/>}
    {correction && <Dialog title="纠正信息" onClose={closeDialog}><form onSubmit={event => { event.preventDefault(); if (correction.fact.kind === 'belief' && !correction.fact.characterId?.trim()) { notify('角色误信必须指定角色。', true); return; } void action<{ id: string }>({ action: 'correct-fact', id: correction.id, fact: correction.fact }, correction.version).then(result => { setSelected(result.id); setTab(correction.fact.kind); setStateFilter('all'); setCorrection(null); notify('作者纠正已保存，旧记录仍可追溯。'); }).catch(() => undefined); }}>
      <div className="field-row"><Field label="主体"><input required value={correction.fact.subject} onChange={e => setCorrection({ ...correction, fact: { ...correction.fact, subject: e.target.value } })}/></Field><Field label="关系"><select value={correction.fact.relation} onChange={e => setCorrection({ ...correction, fact: { ...correction.fact, relation: e.target.value as Fact['relation'] } })}>{Object.entries(relations).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field></div>
      <Field label="信息内容"><input required value={correction.fact.value} onChange={e => setCorrection({ ...correction, fact: { ...correction.fact, value: e.target.value } })}/></Field>
      <div className="field-row"><Field label="信息类型"><select value={correction.fact.kind} onChange={e => setCorrection({ ...correction, fact: { ...correction.fact, kind: e.target.value as Fact['kind'] } })}>{Object.entries(kinds).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field><Field label="相关角色"><input value={correction.fact.characterId ?? ''} onChange={e => setCorrection({ ...correction, fact: { ...correction.fact, characterId: e.target.value || null } })}/></Field></div>
      <div className="field-row"><Field label="故事时间"><input placeholder="未知" value={correction.fact.storyTime ?? ''} onChange={e => setCorrection({ ...correction, fact: { ...correction.fact, storyTime: e.target.value || null } })}/></Field><Field label="获知时间"><input placeholder="未知" value={correction.fact.knowledgeTime ?? ''} onChange={e => setCorrection({ ...correction, fact: { ...correction.fact, knowledgeTime: e.target.value || null } })}/></Field></div>
      <Field label="来源段落" hint="只能选择同一来源版本中的原文。"><select value={correction.fact.evidence.blockId} disabled={!correctionSource.value} onChange={e => { const block = correctionSource.value?.blocks.find(item => item.id === e.target.value); if (block) setCorrection({ ...correction, fact: { ...correction.fact, evidence: { chapterId: correction.fact.evidence.chapterId, revisionId: correction.fact.evidence.revisionId, blockId: block.id, quote: block.text, start: block.start, end: block.end } } }); }}>{correctionSource.value?.blocks.map(block => <option key={block.id} value={block.id}>{block.text.slice(0, 70)}</option>)}</select></Field>
      {correctionSource.error ? <ErrorText error={correctionSource.error}/> : null}
      <div className="dialog-actions"><Button onClick={closeDialog}>取消</Button><Button type="submit" variant="primary" disabled={busy || correction.version !== data.project.version || !correctionSource.value}>保存纠正</Button></div>
    </form></Dialog>}
    {editor && <Dialog title={editor.kind === 'aliases' ? '管理人物别名' : '作者约束'} onClose={closeDialog}><form onSubmit={event => { event.preventDefault(); const input = editor.kind === 'aliases' ? { action: 'aliases' as const, entity: editor.entity.trim(), names: editor.text.split(/[，,\n]/u).map(item => item.trim()).filter(Boolean) } : { action: 'constraints' as const, values: editor.text.split('\n').map(item => item.trim()).filter(Boolean) }; void action(input, editor.version).then(() => { setEditor(null); notify('已更新，当前候选与上下文状态已刷新。'); }).catch(() => undefined); }}>
      {editor.kind === 'aliases' && <Field label="人物标识" hint="与章节计划中的人物保持一致。"><input required value={editor.entity} onChange={e => setEditor({ ...editor, entity: e.target.value })}/></Field>}
      <Field label={editor.kind === 'aliases' ? '别名' : '独立约束'} hint={editor.kind === 'aliases' ? '多个别名用逗号分隔。' : '每行一条；修改会使派生记忆失效。'}><textarea required={editor.kind === 'aliases'} rows={6} value={editor.text} onChange={e => setEditor({ ...editor, text: e.target.value })}/></Field>
      {editor.version !== data.project.version && <Banner>作品版本已变化，请保留输入后重新打开。</Banner>}<div className="dialog-actions"><Button onClick={closeDialog}>取消</Button><Button type="submit" variant="primary" disabled={busy || editor.version !== data.project.version}>保存</Button></div>
    </form></Dialog>}
  </>;
}
