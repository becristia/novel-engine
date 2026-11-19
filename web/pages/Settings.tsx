import { useState } from 'react';
import { Badge, Banner, Button, Field, Icon, PageHeader, Panel } from '../components.js';
import type { ConfigurationView, PageProps, WorkspaceView } from '../model.js';

type Props = Pick<PageProps, 'budget' | 'setBudget' | 'busy' | 'perform' | 'refreshConfig' | 'notify' | 'job' | 'navigate'> & { config: ConfigurationView | null; data: WorkspaceView | null };
export function SettingsPage({ config, data, budget, setBudget, busy, perform, refreshConfig, notify, job, navigate }: Props) {
  const [requests, setRequests] = useState(String(budget.maxRequests)); const [tokens, setTokens] = useState(String(budget.maxTokens));
  const valid = [requests, tokens].every(value => /^[1-9]\d*$/u.test(value) && Number.isSafeInteger(Number(value)));
  const dirty = requests !== String(budget.maxRequests) || tokens !== String(budget.maxTokens);
  const probe = data?.runs.find(run => run.kind === 'probe' && run.configurationHash === config?.configurationHash);
  const modelBusy = Boolean(data?.runs.some(run => run.active));
  const canProbe = Boolean(data && config?.credentialAvailable && config.offlineOk && !busy && !modelBusy);
  return <>
    <PageHeader title="模型与设置" subtitle="检查本地配置，为下一次任务设置预算。" actions={<Badge>{config?.provider === 'fake' ? '离线模型' : '本地配置'}</Badge>}/>
    <Panel title="故事检索"><Badge>本地规则与来源检索</Badge><p>Hindsight 尚未通过真实服务、中文召回和内部费用控制准入。当前使用本地读取路径，页面浏览和上下文预览不调用外部检索。</p></Panel>
    {!config ? <Panel><Banner>无法读取模型配置，请检查启动时指定的配置文件。</Banner><Button onClick={() => void perform(refreshConfig).catch(() => undefined)}>重新检查配置</Button></Panel> : <div className="settings-layout">
      <div className="stack"><Panel className="model-panel"><div className="section-heading"><h2>当前模型</h2><Badge>只读</Badge></div><dl className="model-values">
        <div><dt>接口类型</dt><dd>{config.provider === 'fake' ? 'FakeProvider · 离线响应' : 'OpenAI 兼容'}</dd></div>
        <div><dt>模型名称</dt><dd>{config.modelId}</dd></div>
        <div><dt>服务地址</dt><dd>{config.baseURL ?? '不连接外部服务'}</dd></div>
        <div><dt>配置来源</dt><dd>{config.source === 'builtin' ? '内置配置' : config.source}</dd></div>
        <div><dt>{config.provider === 'fake' ? '创作响应' : '凭据变量'}</dt><dd>{config.apiKeyEnv ?? (config.hasFakeResponses ? '已指定固定响应文件' : '仅提供一次探测响应')}<Badge tone={config.provider === 'fake' ? config.hasFakeResponses ? 'green' : 'amber' : config.credentialAvailable ? 'green' : 'amber'}>{config.provider === 'fake' ? config.hasFakeResponses ? '已配置' : '仅供探测' : config.credentialAvailable ? '已配置' : '未配置'}</Badge></dd></div>
      </dl><p className="help-text">密钥仅在本机配置，页面不显示密钥内容。修改环境变量后需重启工作台。</p></Panel>
        <Panel className="budget-panel"><h2>下一次任务预算</h2><div className="field-row"><Field label="请求次数上限"><input type="number" min={1} step={1} value={requests} onChange={e => setRequests(e.target.value)}/></Field><Field label="token 总预算"><input type="number" min={1} step={1} value={tokens} onChange={e => setTokens(e.target.value)}/></Field></div>
          <div className="row-title"><p className="help-text">当前有效预算：{budget.maxRequests} 次请求，{budget.maxTokens.toLocaleString()} token。</p><Button disabled={!valid || !dirty} onClick={() => { setBudget({ maxRequests: Number(requests), maxTokens: Number(tokens) }); notify('预算已应用于下一次新任务。恢复任务仍使用原预算。'); }}>应用预算</Button></div>
          {!valid && <Banner tone="red">请输入正的安全整数；当前输入尚未应用。</Banner>}
          <Banner tone="neutral">{config.prices ? `价格版本：${config.prices.version}。费用按实际 usage 估算。` : '价格未提供 · 费用将显示未知'}</Banner>
        </Panel>
      </div>
      <div className="stack"><Panel className="offline-panel"><h2>离线检查</h2><dl className="check-values"><div><dt>Node.js {config.nodeVersion}</dt><dd className={config.offlineOk ? 'success-text' : 'attention-text'}><Icon name={config.offlineOk ? 'check' : 'warning'}/>{config.offlineOk ? '版本符合要求' : '版本不受支持'}</dd></div><div><dt>配置格式</dt><dd className="success-text"><Icon name="check"/>通过</dd></div></dl><Button className="wide" variant="primary" disabled={busy} onClick={() => void perform(async () => { await refreshConfig(); notify('本地环境与配置已重新检查。'); }).catch(() => undefined)}>重新检查配置</Button><p className="help-text">仅检查本地环境与配置。</p></Panel>
        <Panel className="probe-panel"><div className="section-heading"><h2>模型连通</h2><Badge tone={probe?.status === 'succeeded' ? 'green' : 'amber'}>{probe?.active ? '探测中' : probe?.status === 'succeeded' ? '探测通过' : probe ? '探测未完成' : '未探测'}</Badge></div><p>{config.provider === 'fake' ? '探测只使用本地固定响应。' : '探测将调用模型服务。'}</p><p>最多 1 次请求 · 4,096 token</p>
          <Button className="wide" disabled={!canProbe} variant="primary" onClick={() => void job({ kind: 'probe' }, { maxRequests: 1, maxTokens: 4096 }).then(() => notify('探测任务已启动。')).catch(() => undefined)}>探测模型</Button>
          {!data ? <Banner>请先打开作品，以便保存探测记录。</Banner> : !config.credentialAvailable ? <Banner>请先在本机配置 {config.apiKeyEnv}。</Banner> : modelBusy ? <p className="help-text">请等待当前任务结束。</p> : <p className="help-text">探测只表示接口可用，不代表创作质量通过。</p>}
          {probe && <Button variant="ghost" onClick={() => navigate('runs', { runId: probe.id })}>查看探测记录</Button>}
        </Panel>
      </div>
    </div>}
  </>;
}
