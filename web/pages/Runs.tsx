import { useEffect, useState } from 'react';
import { DraftPayloadSchema, PlanPayloadSchema } from '../../src/domain/planning.js';
import { SelectionSchema } from '../../src/domain/patch.js';
import { Badge, Banner, Button, Dialog, Empty, Icon, PageHeader, Panel, Tabs } from '../components.js';
import { api } from '../api.js';
import { workspacePath } from '../model.js';
import type { PageProps, WorkspaceView } from '../model.js';

type Run = WorkspaceView['runs'][number];
const kindLabels: Record<string, string> = { plan: '章节规划', write: '生成并审稿', draft: '生成候选', review: '章节审稿', revise: '修订候选', impact: '影响分析', selection: '所选候选', memory: '记忆重建', probe: '模型探测' };
const statusLabels = { queued: '准备执行', running: '执行中', awaiting_approval: '等待批准', succeeded: '已完成', failed: '运行中断', cancelled: '已取消', stale: '输入已过期' };
const attemptLabels = { inflight: '等待结果', received: '已保存，待校验', succeeded: '已完成', failed: '失败', unknown: '结果未知' };
function stepName(step: string): string {
  if (step.includes(':scene:')) return `${step.startsWith('revision:') ? '修订' : '生成'}场景 ${step.split(':scene:')[1]}`;
  if (step.startsWith('memory-summary:')) return '重建摘要'; if (step.startsWith('memory-facts:')) return '提取信息';
  const key = step.split(':')[0]!; return { plan: '章节规划', draft: '生成候选', revision: '修订候选', review: '审稿', extract: '提取信息', probe: '模型探测', impact: '影响分析' }[key] ?? '模型步骤';
}
interface Replay { ok: boolean; originalStatus: string; databaseChanges: number; unresolved: string[]; checks: { target: string; ok: boolean; result: string }[] }
export function RunsPage({ data, busy, focus, navigate, action, job, perform, notify }: PageProps) {
  const [filter, setFilter] = useState('all'); const [search, setSearch] = useState(''); const [selected, setSelected] = useState(focus.runId ?? data.runs[0]?.id ?? '');
  const [acknowledged, setAcknowledged] = useState(false); const [replay, setReplay] = useState<Replay | null>(null);
  useEffect(() => { if (focus.runId) { setSelected(focus.runId); setFilter('all'); } }, [focus.runId]);
  useEffect(() => setAcknowledged(false), [selected]);
  const pendingFor = (run: Run) => data.proposals.filter(proposal => proposal.runId === run.id || proposal.id === run.proposalId).some(proposal => proposal.status === 'pending' && !proposal.stale);
  const label = (run: Run) => run.active && run.cancelled ? '正在停止' : run.interrupted ? '运行中断' : run.status === 'awaiting_approval' && !pendingFor(run) ? '提案已处理' : statusLabels[run.status];
  const title = (run: Run) => {
    if (run.kind === 'plan') { const proposal = data.proposals.find(item => item.kind === 'plan' && item.runId === run.id); const plans = proposal ? PlanPayloadSchema.parse(proposal.payload).plans : []; return `${plans.length ? `第 ${plans[0]!.ordinal}～${plans.at(-1)!.ordinal} 章 · ` : ''}章节规划`; }
    return `${run.chapter ? `第 ${run.chapter} 章 · ` : ''}${kindLabels[run.kind] ?? '创作任务'}`;
  };
  const visible = data.runs.filter(run => {
    const pending = !run.active && (run.interrupted || run.status === 'failed' || (run.status === 'awaiting_approval' && pendingFor(run)));
    return (filter === 'all' || filter === 'running' && run.active || filter === 'pending' && pending || filter === 'ended' && !run.active && !pending) && `${title(run)} ${run.title ?? ''}`.includes(search);
  });
  const run = visible.find(item => item.id === selected) ?? visible[0];
  const proposal = run ? data.proposals.findLast(item => item.runId === run.id || item.id === run.proposalId) : undefined;
  const stale = Boolean(run && run.baseVersion !== data.project.version && !['succeeded', 'cancelled'].includes(run.status));
  const resumable = Boolean(run && !run.active && !run.cancelled && !stale && (run.interrupted || run.status === 'failed'));
  const openArtifact = () => {
    if (!proposal) return;
    if (proposal.kind === 'plan') navigate('planning', { proposalId: proposal.id });
    else if (proposal.kind === 'draft') { const draft = DraftPayloadSchema.parse(proposal.payload); navigate('chapters', { chapterId: draft.chapterId, revisionId: draft.revisionId }); }
    else navigate('patches', { proposalId: proposal.kind === 'selection' ? SelectionSchema.parse(proposal.payload).sourceProposalId : proposal.id });
  };
  const steps = run ? [...new Set(run.attempts.map(attempt => stepName(attempt.step)))] : [];
  if (run && ['write', 'revise'].includes(run.kind)) for (const step of ['生成候选', '审稿', '提取信息']) if (!steps.includes(step)) steps.push(step);
  const needsApproval = Boolean(run && ['write', 'draft', 'revise', 'plan', 'selection', 'impact'].includes(run.kind));
  return <>
    <PageHeader title="任务记录" subtitle="查看进度、已保存结果与下一步。"/>
    {data.story.enabled && <details className="panel story-sync"><summary>记忆同步队列 · {data.memoryJobs.filter(item => item.status === 'pending').length} 项待同步</summary><p className="help-text">本地正文和失效状态已经保存。外部检索服务通过准入前，任务保留在队列中。</p>{data.memoryJobs.map(item => <p key={item.id}><Badge>{({ pending: '待同步', inflight: '处理中', unknown: '结果未知，先查询', failed: '已失败', succeeded: '已同步', obsolete: '旧来源，不再采用' } as Record<string, string>)[item.status]}</Badge> 来源 {item.sourceId.slice(0, 8)} · 尝试 {item.attempts} 次{item.externalId ? ' · 已保存外部操作身份' : ''}</p>)}</details>}
    <div className="filter-tabs"><Tabs items={[{ value: 'all', label: '全部' }, { value: 'running', label: '进行中' }, { value: 'pending', label: '待处理' }, { value: 'ended', label: '已结束' }]} value={filter} onChange={setFilter}/></div>
    <div className="runs-layout">
      <Panel className="run-list"><div className="search-box"><Icon name="search"/><input aria-label="搜索章节或任务" placeholder="搜索章节或任务" value={search} onChange={e => setSearch(e.target.value)}/></div>
        <div className="stack">{visible.map(item => <button key={item.id} className={`run-row ${item.id === run?.id ? 'selected' : ''}`} onClick={() => setSelected(item.id)}><Icon name="file" size={28}/><span><strong>{title(item)}</strong><small>{item.hasUnknown ? '存在结果未知的请求' : item.title ?? item.modelId}</small></span><Badge tone={item.status === 'succeeded' ? 'green' : item.active || item.status === 'failed' || item.status === 'awaiting_approval' ? 'amber' : 'neutral'}>{label(item)}</Badge></button>)}</div>
        {!visible.length && <p className="muted">没有符合条件的任务。</p>}
      </Panel>
      {run ? <Panel className="run-details"><h2>{title(run)}</h2>
        {run.hasUnknown && <Banner><strong>请求结果未知</strong><p>服务连接中断或任务已取消，可能已产生用量。不会自动重试。</p></Banner>}
        {stale && <Banner>输入作品版本已变化，请基于当前正式稿新建任务。</Banner>}
        {run.active && <Banner tone="neutral">{run.cancelled ? '已请求停止，正在等待在途调用结束。' : '任务正在后台执行，刷新页面可继续查看。'}</Banner>}
        <div className="run-detail-grid"><section className="detail-box"><h3>实际步骤</h3><ol className="step-list">{steps.map(step => {
          const attempt = run.attempts.findLast(item => stepName(item.step) === step);
          return <li key={step}><span className={`step-symbol ${attempt?.status === 'succeeded' ? 'done' : attempt ? 'attention' : ''}`}>{attempt?.status === 'succeeded' ? <Icon name="check" size={17}/> : attempt ? '?' : ''}</span><div><strong>{step}</strong><small>{attempt ? attemptLabels[attempt.status] : '未开始'}</small></div></li>;
        })}{needsApproval && <li><span className={`step-symbol ${proposal?.status === 'approved' ? 'done' : ''}`}>{proposal?.status === 'approved' && <Icon name="check" size={17}/>}</span><div><strong>作者批准</strong><small>{proposal?.status === 'approved' ? '已批准' : proposal?.status === 'rejected' ? '已拒绝' : proposal?.approval.canApprove ? '等待作者处理' : '未完成'}</small></div></li>}</ol>{!steps.length && !needsApproval && <p className="muted">还没有模型请求记录。</p>}</section>
          <section className="detail-box"><h3>预算与用量</h3><dl className="key-values"><div><dt>已发请求</dt><dd>{run.attempts.length} / {run.budget.maxRequests}</dd></div><div><dt>预算占用</dt><dd>{run.reservedTokens.toLocaleString()} / {run.budget.maxTokens.toLocaleString()}<small>用量缺失时保留请求预留</small></dd></div><div><dt>估算费用</dt><dd>{run.estimatedCost === null ? '未知' : `$${run.estimatedCost.toFixed(6)}`}</dd></div></dl></section>
        </div>
        {proposal && <div className="artifact-row"><Icon name="file"/><span>{proposal.kind === 'plan' ? '章节计划已保存' : proposal.kind === 'patch' ? '修改方案已保存' : '候选稿已保存'}</span><button className="link-button" type="button" onClick={openArtifact}>{proposal.kind === 'plan' ? '查看计划' : proposal.kind === 'patch' || proposal.kind === 'selection' ? '查看修改方案' : '查看候选稿'}　›</button></div>}
        <section className="recovery"><h3>继续这项任务</h3><p className="help-text">已保存步骤可以复用，重试仍受原任务预算限制。</p>
          {run.hasUnknown && resumable && <label className="check-label"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)}/>我理解重试可能产生额外用量</label>}
          <div className="actions-row">{resumable && <Button variant="primary" disabled={busy || Boolean(run.hasUnknown && !acknowledged)} onClick={() => void job({ kind: 'resume', runId: run.id, retryUnknown: acknowledged }).then(() => { setAcknowledged(false); notify('已恢复任务，继续使用原任务预算。'); }).catch(() => undefined)}>{run.hasUnknown ? '重试未知请求' : '恢复任务'}</Button>}
            {proposal?.status === 'pending' && !proposal.stale && !resumable && !run.active && <Button variant="primary" onClick={openArtifact}>查看待处理提案</Button>}
            <Button disabled={busy || run.cancelled || run.status === 'succeeded'} onClick={() => void action({ action: 'cancel', runId: run.id }).then(() => notify('已取消任务；在途请求保留未知记录。')).catch(() => undefined)}>取消任务</Button>
          </div>
          <div className="replay-row"><Button disabled={busy || run.active} onClick={() => void perform(async () => setReplay(await api.post<Replay>(workspacePath(data.project.id, `runs/${run.id}/replay`)))).catch(() => undefined)}>只读重放</Button><span className="help-text">仅核对已保存记录，不请求模型。</span></div>
        </section>
        <details className="request-details"><summary>请求明细与诊断</summary><p className="help-text">运行 ID：{run.id}</p><div className="table-scroll"><table><thead><tr><th>步骤</th><th>状态</th><th>诊断代码</th></tr></thead><tbody>{run.attempts.map(attempt => <tr key={attempt.id}><td>{stepName(attempt.step)}</td><td>{attemptLabels[attempt.status]}</td><td>{attempt.error ?? '无'}</td></tr>)}</tbody></table></div></details>
      </Panel> : <Panel><Empty title="暂无任务记录" detail="发起规划、生成、审稿或模型探测后，进度与恢复入口会显示在这里。"/></Panel>}
    </div>
    {replay && <Dialog title="只读重放结果" onClose={() => setReplay(null)}><Banner tone={replay.ok ? 'green' : 'amber'}>{replay.ok ? '已保存记录核对通过。' : '存在未确认请求或未通过的检查。'} 数据库变更：{replay.databaseChanges}。</Banner><p className="help-text">重放结果不等于原任务成功，也不评价创作质量。</p><div className="stack">{replay.checks.map((check, index) => <div className="replay-check" key={index}><Badge tone={check.ok ? 'green' : 'amber'}>{check.ok ? '通过' : '待核查'}</Badge><span>{check.result}</span></div>)}</div></Dialog>}
  </>;
}
