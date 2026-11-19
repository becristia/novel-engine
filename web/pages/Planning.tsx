import { useEffect, useState } from 'react';
import { PlanPayloadSchema, PlanContentSchema } from '../../src/domain/planning.js';
import type { ApprovedPlan } from '../../src/domain/planning.js';
import type { Proposal } from '../../src/storage/proposal-store.js';
import { Badge, Banner, Button, Dialog, Empty, Field, PageHeader, Panel, TagsInput } from '../components.js';
import { modelReady } from '../model.js';
import type { PageProps } from '../model.js';
import { useUnsavedChanges } from '../hooks.js';
import { ScenePlanEditor } from '../story-plan.js';

const toForm = (plan: ApprovedPlan) => ({ title: plan.title, goal: plan.goal, characters: plan.characters.join('，'), constraints: plan.constraints.join('\n'), events: plan.events.join('\n'), targetLength: String(plan.targetLength), viewpointCharacter: plan.viewpointCharacter ?? '', scenes: plan.scenes ?? [] });
const lines = (value: string) => value.split('\n').map(item => item.trim()).filter(Boolean);
export function PlanningPage(props: PageProps) {
  const { data, config, busy, action, job, notify, navigate } = props;
  const batches = data.proposals.filter(item => item.kind === 'plan');
  const latest = batches.findLast(item => item.status === 'pending' && !item.stale) ?? batches.at(-1);
  const [selected, setSelected] = useState(latest?.id ?? ''); const batch = batches.find(item => item.id === selected) ?? latest;
  const plans = batch ? PlanPayloadSchema.parse(batch.payload).plans : [];
  const [ordinal, setOrdinal] = useState(plans[0]?.ordinal ?? 1); const plan = plans.find(item => item.ordinal === ordinal) ?? plans[0];
  const [form, setForm] = useState<ReturnType<typeof toForm> | null>(plan ? toForm(plan) : null);
  const [generate, setGenerate] = useState(false); const [brief, setBrief] = useState(''); const [count, setCount] = useState('3');
  useEffect(() => { if (latest?.id) setSelected(latest.id); }, [latest?.id]);
  useEffect(() => { if (props.focus.proposalId) setSelected(props.focus.proposalId); }, [props.focus.proposalId]);
  useEffect(() => { if (plan) setForm(toForm(plan)); }, [batch?.id, plan?.chapterId, plan?.revisionId]);
  const editable = batch?.status === 'pending' && !batch.stale;
  const dirty = Boolean(form && plan && JSON.stringify(form) !== JSON.stringify(toForm(plan)));
  useUnsavedChanges(dirty);
  const active = busy || data.runs.some(run => run.active);
  const ready = modelReady(config) && !active;
  const run = batch ? data.runs.find(item => item.id === batch.runId) : undefined;
  const submitPlan = async () => {
    if (!batch || !plan || !form) return;
    const value = PlanContentSchema.safeParse({ title: form.title.trim(), goal: form.goal.trim(), characters: form.characters.split(/[，,\n]/u).map(v => v.trim()).filter(Boolean), constraints: lines(form.constraints), events: lines(form.events), targetLength: Number(form.targetLength), viewpointCharacter: form.viewpointCharacter.trim() || null, ...(form.scenes.length ? { scenes: form.scenes } : {}) });
    if (!value.success) { notify('请填写标题、目标和有效的目标字数。', true); return; }
    const result = await action<Proposal>({ action: 'edit-plan', proposalId: batch.id, chapter: plan.ordinal, plan: value.data });
    setSelected(result.id); notify('计划修改已保存为新提案。');
  };
  const field = (key: Exclude<keyof NonNullable<typeof form>, 'scenes'>, value: string) => setForm(current => current ? { ...current, [key]: value } : null);
  const generator = <form onSubmit={event => { event.preventDefault(); void job({ kind: 'plan', brief, chapters: Number(count) }).then(() => { setGenerate(false); notify('规划任务已启动，可在任务记录中查看进度。'); }).catch(() => undefined); }}>
    <Field label="创作要求"><textarea required value={brief} onChange={event => setBrief(event.target.value)} placeholder="这几章需要推进什么情节？有哪些人物、约束和期待的转折？" rows={5}/></Field>
    <Field label="本批章节数" hint="每批支持 1～20 章。"><input type="number" min={1} max={20} required value={count} onChange={event => setCount(event.target.value)}/></Field>
    <p className="help-text">本次预算：最多 {props.budget.maxRequests} 次请求，{props.budget.maxTokens.toLocaleString()} token。</p>
    {!modelReady(config) && <Banner>请先在模型与设置中配置用于创作的模型或离线响应文件。</Banner>}
    <div className="dialog-actions"><Button type="submit" variant="primary" disabled={!ready || !brief.trim()}>生成计划</Button></div>
  </form>;
  return <>
    <PageHeader title="章节规划" subtitle="明确每章目标，批准后进入写作。" actions={<>{batch && <Badge tone="amber">本批 {plans.length} 章</Badge>}<Button disabled={active || dirty} onClick={() => { setBrief(run?.brief ?? ''); setGenerate(true); }}>{batch ? '重新生成计划' : '新建章节计划'}</Button></>}/>
    {!batch || !plan || !form ? <div className="planning-start"><Panel title="生成章节计划">{generator}</Panel><Empty title="从一个明确的创作方向开始" detail="系统先生成章节计划，由你修改和批准，再逐章写作。"/></div> : <>
      <div className="brief-strip"><strong>创作要求</strong><span>{run?.brief ?? '此计划的创作要求未记录。'}</span>{batches.length > 1 && <select aria-label="计划批次" value={batch.id} onChange={e => { if (dirty) { notify('请先保存当前章节修改。', true); return; } setSelected(e.target.value); }}>{batches.map((item, index) => <option value={item.id} key={item.id}>第 {index + 1} 批 · {item.status === 'pending' ? '待批准' : item.status === 'approved' ? '已批准' : '历史计划'}</option>)}</select>}</div>
      {batch.stale && batch.status === 'pending' && <Banner>这份计划基于旧作品版本，需重新生成后再批准。</Banner>}
      <div className="planning-layout">
        <Panel title="本批计划" className="plan-chapters"><div className="stack">{plans.map(item => <button type="button" className={`plan-card ${item.chapterId === plan.chapterId ? 'selected' : ''}`} key={item.chapterId} onClick={() => { if (dirty) { notify('请先保存当前章节修改。', true); return; } setOrdinal(item.ordinal); }}><strong>{String(item.ordinal).padStart(2, '0')}　{item.title}</strong><span><i className={`status-dot ${batch.status === 'approved' ? 'green' : ''}`}/>{batch.status === 'approved' ? '已批准' : batch.stale ? '已过期' : batch.status === 'pending' ? '待批准' : '历史计划'}</span></button>)}</div><p className="help-text panel-foot">每批支持 1～20 章。</p></Panel>
        <Panel className="plan-editor"><div className="section-heading"><h2>第 {plan.ordinal} 章 · {plan.title}</h2><Badge tone={batch.status === 'approved' ? 'green' : 'amber'}>{batch.status === 'approved' ? '计划已批准' : '计划待批准'}</Badge></div>
          <Field label="章节标题"><input disabled={!editable} value={form.title} onChange={e => field('title', e.target.value)}/></Field>
          <Field label="本章目标"><textarea disabled={!editable} value={form.goal} onChange={e => field('goal', e.target.value)}/></Field>
          <div className="field-row"><Field label="叙事视角"><input disabled={!editable} value={form.viewpointCharacter} placeholder="未指定" onChange={e => field('viewpointCharacter', e.target.value)}/></Field><Field label="目标字数"><input disabled={!editable} type="number" min={1} value={form.targetLength} onChange={e => field('targetLength', e.target.value)}/></Field></div>
          <Field label="出场人物"><TagsInput disabled={!editable} value={form.characters.split(/[，,\n]/u).map(v => v.trim()).filter(Boolean)} onChange={value => field('characters', value.join('，'))}/></Field>
          <Field label="关键事件" hint="每行一个事件。"><textarea disabled={!editable} value={form.events} onChange={e => field('events', e.target.value)} rows={3}/></Field>
          <Field label="本章约束"><textarea disabled={!editable} value={form.constraints} onChange={e => field('constraints', e.target.value)}/></Field>
          <ScenePlanEditor scenes={form.scenes} onChange={scenes => setForm({ ...form, scenes })} story={data.story.story} disabled={!editable}/>
        </Panel>
        <Panel className="author-constraints"><div className="section-heading"><h2>作者约束</h2><Badge tone="amber">来自作品约束</Badge></div><div className="stack">{data.snapshot.state.constraints.length ? data.snapshot.state.constraints.map((constraint, index) => <div className="constraint-card" key={index}><span className="number-disc">{index + 1}</span><p>{constraint}</p></div>) : <p className="muted">暂无独立约束。</p>}</div><div className="divider"/><h3>使用范围</h3><Banner>章节计划是未来安排，不能当作已发生事实。</Banner></Panel>
      </div>
      <div className="action-bar"><span>{dirty ? '当前修改尚未保存' : batch.status === 'approved' ? '计划已批准，可进入章节工作台' : '当前计划已保存 · 等待批准'}</span><div className="actions-row"><Button disabled={!editable || !dirty || busy} onClick={() => void submitPlan().catch(() => undefined)}>保存计划修改</Button><Button disabled={!editable || busy} onClick={() => void action({ action: 'reject', proposalId: batch.id }).then(() => notify('计划已拒绝。')).catch(() => undefined)}>拒绝本批</Button>{batch.status === 'approved' ? <Button variant="primary" onClick={() => navigate('chapters', { chapterId: plan.chapterId })}>进入章节工作台</Button> : <Button variant="primary" disabled={!batch.approval.canApprove || dirty || busy} onClick={() => void action({ action: 'approve', proposalId: batch.id, reason: '' }).then(() => { notify('本批计划已批准。'); navigate('chapters', { chapterId: plans[0]!.chapterId }); }).catch(() => undefined)}>批准本批 {plans.length} 章</Button>}</div></div>
    </>}
    {generate && <Dialog title="生成章节计划" onClose={() => setGenerate(false)}>{generator}</Dialog>}
  </>;
}
