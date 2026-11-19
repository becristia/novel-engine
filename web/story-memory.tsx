import { useState } from 'react';
import type { StoryCollection, StorySource } from '../src/domain/story-memory.js';
import type { ContextSnapshot } from '../src/context/builder.js';
import { Badge, Banner, Button, Dialog, Empty, ErrorText, Field, Panel, Tabs } from './components.js';
import type { PageProps } from './model.js';
import { workspacePath } from './model.js';
import { useResource, useUnsavedChanges } from './hooks.js';
import { ContextList, SourceDialog } from './reading.js';

const labels: Record<StoryCollection, string> = { entities: '人物身份', events: '故事事件', scenes: '场景', claims: '断言', knowledge: '人物认知', disclosures: '读者披露', threads: '伏笔', rules: '风格与约束' };
const kinds: Record<string, string> = { fact: '世界事实', belief: '角色误信', plan: '未来计划', speech: '人物言语', rumor: '传闻', dream: '梦境', inference: '推测' };
const statuses: Record<string, string> = { fresh: '有效', pending: '待采纳', stale: '已失效', actual: '已发生', planned: '计划中', unknown: '未知', planted: '已埋设', resolved: '已回收', abandoned: '已放弃' };
type Row = { id: string; source?: StorySource; [key: string]: unknown };
type Option = { value: string; label: string };
interface FormField { key: string; label: string; options?: Option[]; text?: boolean }
const choices = (pairs: Record<string, string>): Option[] => Object.entries(pairs).map(([value, label]) => ({ value, label }));
const lines = (text: string) => text.split(/[，,\n]/u).map(item => item.trim()).filter(Boolean);

export function StoryMemoryPanel({ data, busy, action, notify }: Pick<PageProps, 'data' | 'busy' | 'action' | 'notify'>) {
  const story = data.story.story;
  const [collection, setCollection] = useState<StoryCollection>('claims');
  const [query, setQuery] = useState(''); const [selected, setSelected] = useState('');
  const [editor, setEditor] = useState<{ collection: StoryCollection; original: Row | null; values: Record<string, string>; version: number } | null>(null);
  const [order, setOrder] = useState<{ before: string; after: string; version: number } | null>(null);
  const [source, setSource] = useState<StorySource | null>(null);
  const [sceneId, setSceneId] = useState(story.scenes.find(scene => data.snapshot.state.plans[scene.chapterId])?.id ?? '');
  const context = useResource<ContextSnapshot>(data.story.enabled && sceneId ? workspacePath(data.project.id, `context?scene=${encodeURIComponent(sceneId)}`) : null, data.project.version);
  useUnsavedChanges(Boolean(editor || order));
  const entityOptions = story.entities.map(item => ({ value: item.id, label: story.entities.filter(other => other.name === item.name).length > 1 ? `${item.name} · ${item.id.slice(0, 8)}` : item.name }));
  const eventOptions = story.events.map(item => ({ value: item.id, label: item.title }));
  const sceneOptions = story.scenes.map(item => ({ value: item.id, label: item.title }));
  const claimOptions = story.claims.map(item => ({ value: item.id, label: `${story.entities.find(entity => entity.id === item.subjectId)?.name ?? ''}：${item.value}` }));
  const optional = (items: Option[], label = '未知／未指定') => [{ value: '', label }, ...items];
  const chapterOptions = [...data.snapshot.state.chapters.map(item => ({ value: item.id, label: item.title })), ...Object.values(data.snapshot.state.plans).filter(item => !data.snapshot.state.chapters.some(chapter => chapter.id === item.chapterId)).map(item => ({ value: item.chapterId, label: item.title }))];
  const specifications: Record<StoryCollection, FormField[]> = {
    entities: [{ key: 'name', label: '人物名称' }, { key: 'aliases', label: '人物别名', text: true }],
    events: [{ key: 'title', label: '事件名称' }, { key: 'occurrence', label: '事件状态', options: choices({ actual: '已发生', planned: '计划中', unknown: '未知' }) }],
    scenes: [{ key: 'title', label: '场景名称' }, { key: 'chapterId', label: '所属章节', options: chapterOptions }, { key: 'narration', label: '叙述方式', options: choices({ unspecified: '尚未确定', limited: '有限视角', omniscient: '全知叙述', unreliable: '不可靠叙述' }) }, { key: 'viewpointId', label: '视角人物', options: optional(entityOptions) }, { key: 'eventId', label: '故事位置', options: optional(eventOptions) }, { key: 'goal', label: '场景目标', text: true }, { key: 'instructions', label: '安全执行指令', text: true }],
    claims: [{ key: 'subjectId', label: '主体人物', options: entityOptions }, { key: 'relation', label: '关系', options: choices({ identity: '身份', location: '地点', possession: '持有物', knowledge: '知识', event: '事件', foreshadow: '伏笔', condition: '状态' }) }, { key: 'value', label: '断言内容', text: true }, { key: 'kind', label: '内容种类', options: choices(kinds) }, { key: 'holderId', label: '想法或言语归属', options: optional(entityOptions) }, { key: 'fromEventId', label: '开始生效事件', options: optional(eventOptions) }, { key: 'untilEventId', label: '结束生效事件', options: optional(eventOptions, '没有结束事件') }, { key: 'visibility', label: '披露范围', options: choices({ restricted: '按场景披露', public: '读者可知' }) }],
    knowledge: [{ key: 'characterId', label: '认知人物', options: entityOptions }, { key: 'claimId', label: '对应命题', options: claimOptions }, { key: 'stance', label: '认知态度', options: choices({ knows: '知道事实', believes: '相信', suspects: '怀疑', heard: '听说' }) }, { key: 'learnedAt', label: '获知事件', options: optional(eventOptions) }, { key: 'untilEventId', label: '认知失效事件', options: optional(eventOptions, '没有结束事件') }],
    disclosures: [{ key: 'claimId', label: '披露命题', options: claimOptions }, { key: 'sceneId', label: '披露场景', options: sceneOptions }, { key: 'level', label: '披露程度', options: choices({ hint: '提示线索', reveal: '揭示真相' }) }, { key: 'status', label: '披露状态', options: choices({ planned: '计划披露', actual: '已向读者披露' }) }],
    threads: [{ key: 'title', label: '伏笔名称' }, { key: 'instruction', label: '安全回收指令', text: true }, { key: 'status', label: '伏笔状态', options: choices({ planned: '计划中', ...(editor?.original?.source?.kind === 'text' ? { planted: '已埋设', resolved: '已回收' } : {}), abandoned: '已放弃' }) }, { key: 'dueSceneId', label: '到期场景', options: optional(sceneOptions) }],
    rules: [{ key: 'text', label: '规则内容', text: true }, { key: 'kind', label: '规则类型', options: choices({ constraint: '硬约束', style: '风格' }) }, { key: 'visibility', label: '规则可见范围', options: choices({ writer: '可给当前 Writer', staff: '仅规划与审查' }) }],
  };
  const open = (row: Row | null) => setEditor({ collection, original: row, values: Object.fromEntries(specifications[collection].map(field => [field.key, row?.[field.key] === null ? '' : Array.isArray(row?.[field.key]) ? (row[field.key] as string[]).join('\n') : String(row?.[field.key] ?? field.options?.[0]?.value ?? '')])), version: data.project.version });
  const close = () => { if (window.confirm('有未保存的故事设置，确定放弃这次编辑吗？')) { setEditor(null); setOrder(null); } };
  const name = (id: unknown) => entityOptions.find(item => item.value === id)?.label ?? '未知人物';
  const describe = (row: Row): string => row.value ? `${name(row.subjectId)}：${String(row.value)}` : row.claimId ? `${row.characterId ? `${name(row.characterId)} · ` : ''}${claimOptions.find(item => item.value === row.claimId)?.label ?? '未知命题'}${row.stance ? ` · ${({ knows: '知道', believes: '相信', suspects: '怀疑', heard: '听说' } as Record<string, string>)[String(row.stance)]}` : ''}` : String(row.name ?? row.title ?? row.text ?? row.id);
  const rows = (story[collection] as Row[]).filter(row => describe(row).includes(query));
  const current = rows.find(row => row.id === selected) ?? rows[0];
  const submit = async () => {
    if (!editor) return;
    const type = editor.collection; const fields = editor.values;
    const record: Row = { ...(editor.original ?? {}), id: editor.original?.id ?? crypto.randomUUID() };
    if (type !== 'entities' && type !== 'scenes') record.source = editor.original?.source ?? { kind: 'author', decisionId: crypto.randomUUID() };
    for (const [key, value] of Object.entries(fields)) record[key] = ['aliases', 'instructions'].includes(key) ? value.split('\n').map(item => item.trim()).filter(Boolean) : ['holderId', 'viewpointId', 'eventId', 'fromEventId', 'untilEventId', 'learnedAt', 'dueSceneId'].includes(key) ? value || null : value;
    if (type === 'scenes' && !editor.original) record.revisionId = data.snapshot.state.chapters.find(item => item.id === fields.chapterId)?.revisionId ?? null;
    if (type === 'claims') Object.assign(record, { confirmed: true, status: 'fresh', dependsOn: editor.original?.dependsOn ?? [], correctsId: editor.original?.correctsId ?? null });
    if (type === 'knowledge') record.status = 'fresh';
    if (type === 'threads') record.claimIds = editor.original?.claimIds ?? [];
    if (['events', 'disclosures', 'threads', 'rules'].includes(type)) record.stale = false;
    if (type === 'entities') record.aliases = lines(fields.aliases ?? '');
    await action(type === 'claims' && editor.original ? { action: 'story-correct', id: editor.original.id, value: record } : { action: 'story-set', collection: type, value: record }, editor.version);
    setEditor(null); notify(type === 'claims' && editor.original ? '已保存作者纠正，旧条目与来源仍可追溯。' : '故事设置已保存为新版本。');
  };
  if (!data.story.enabled) return <Panel title="启用小说专用记忆"><p>按事件、场景、人物认知和读者披露管理信息。已有章节会映射为时间与视角未知的场景，需要你补齐后用于新写作。</p><Button variant="primary" disabled={busy} onClick={() => void action({ action: 'story-save', story }).then(() => notify('小说专用记忆已启用，请补齐场景设置。')).catch(() => undefined)}>启用小说专用记忆</Button></Panel>;
  return <div className="story-memory"><Tabs items={Object.entries(labels).map(([value, label]) => ({ value, label }))} value={collection} onChange={value => { setCollection(value as StoryCollection); setSelected(''); }}/>
    <div className="story-memory-grid"><Panel><div className="row-title"><h2>{labels[collection]}</h2><div className="actions-row">{collection === 'events' && <Button onClick={() => setOrder({ before: eventOptions[0]?.value ?? '', after: eventOptions[1]?.value ?? '', version: data.project.version })}>设置事件先后</Button>}<Button variant="primary" onClick={() => open(null)}>新增{labels[collection]}</Button></div></div>
      <Field label="筛选故事信息"><input value={query} onChange={e => setQuery(e.target.value)}/></Field>
      <div className="table-scroll"><table><thead><tr><th>内容</th><th>种类／状态</th><th>作者确认</th></tr></thead><tbody>{rows.map(row => <tr className={`clickable ${current?.id === row.id ? 'selected' : ''}`} key={row.id} tabIndex={0} onClick={() => setSelected(row.id)} onKeyDown={e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); setSelected(row.id); } }}><td>{describe(row)}</td><td>{kinds[String(row.kind)] ?? (row.stale ? '已失效' : statuses[String(row.status ?? row.occurrence)] ?? labels[collection])}</td><td>{collection === 'claims' ? row.confirmed ? '已确认' : '待确认' : '独立记录'}</td></tr>)}</tbody></table></div>
      {!rows.length && <Empty title="暂无记录" detail="作者决定会随作品版本保存；模型抽取需要另外采纳。"/>}
      {collection === 'events' && story.order.map((edge, index) => <div className="row-title" key={index}><p className="help-text">{eventOptions.find(item => item.value === edge.before)?.label} → {eventOptions.find(item => item.value === edge.after)?.label}</p><Button disabled={busy} onClick={() => void action({ action: 'story-save', story: { ...story, order: story.order.filter((_, i) => i !== index) } }).then(() => notify('已撤回这条顺序关系，相关时间重新核对。')).catch(() => undefined)}>撤回顺序关系</Button></div>)}
    </Panel><Panel title="记录与来源">{current ? <div className="stack"><p>{describe(current)}</p><Badge tone={current.status === 'stale' || current.stale ? 'amber' : 'green'}>{current.status === 'stale' || current.stale ? '来源或依赖已失效' : '当前版本记录'}</Badge>
      <dl className="key-values">{specifications[collection].filter(field => current[field.key] !== undefined).map(field => <div key={field.key}><dt>{field.label}</dt><dd>{field.options?.find(option => option.value === (current[field.key] ?? ''))?.label ?? (Array.isArray(current[field.key]) ? (current[field.key] as string[]).join('、') : String(current[field.key] ?? '未知'))}</dd></div>)}</dl>
      {current.source && <><p className="help-text">{current.source.kind === 'author' ? '来源：作者决定' : current.source.kind === 'plan' ? '来源：已批准计划' : '来源：正文证据'}</p>{current.source.kind === 'text' && <blockquote>{current.source.quote}</blockquote>}<Button onClick={() => setSource(current.source!)}>查看故事来源</Button></>}
      {Boolean(current.correctsId) && <p className="help-text">纠正链：{String(current.correctsId)} → 当前条目；原记录仍保留。</p>}
      <Button disabled={busy || collection === 'claims' && current.status !== 'fresh'} onClick={() => open(current)}>{collection === 'claims' ? '纠正断言' : '编辑记录'}</Button>
      {collection === 'claims' && <Button disabled={busy || Boolean(current.confirmed) || current.status !== 'fresh'} onClick={() => void action({ action: 'story-confirm', ids: [current.id] }).then(() => notify('已确认，内容种类保持原样。')).catch(() => undefined)}>确认断言</Button>}
      {collection === 'claims' && <Button disabled={busy || !story.claims.some(item => !item.confirmed && item.status === 'fresh')} onClick={() => void action({ action: 'story-confirm', ids: story.claims.filter(item => !item.confirmed && item.status === 'fresh').map(item => item.id) }).then(() => notify('已批量确认有效断言。')).catch(() => undefined)}>确认全部有效断言</Button>}
    </div> : <p className="muted">选择一条记录查看来源。</p>}</Panel></div>
    <Panel title="场景上下文预览"><Field label="预览目标场景"><select value={sceneId} onChange={e => setSceneId(e.target.value)}><option value="">选择场景</option>{story.scenes.filter(scene => data.snapshot.state.plans[scene.chapterId]).map(scene => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</select></Field>{context.error ? <ErrorText error={context.error}/> : context.value ? <ContextList context={context.value}/> : <p className="help-text">选择已批准计划中的场景。预览仅使用本地数据。</p>}</Panel>
    {editor && <Dialog title={`${editor.original ? '编辑' : '新增'}${labels[editor.collection]}`} onClose={close}><form onSubmit={e => { e.preventDefault(); void submit().catch(() => undefined); }}>
      {specifications[editor.collection].map(field => <Field key={field.key} label={field.label}>{field.options ? <select required={!field.options.some(option => option.value === '')} value={editor.values[field.key] ?? ''} onChange={e => setEditor({ ...editor, values: { ...editor.values, [field.key]: e.target.value } })}>{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.text ? <textarea value={editor.values[field.key] ?? ''} onChange={e => setEditor({ ...editor, values: { ...editor.values, [field.key]: e.target.value } })}/> : <input required value={editor.values[field.key] ?? ''} onChange={e => setEditor({ ...editor, values: { ...editor.values, [field.key]: e.target.value } })}/>}</Field>)}
      <p className="help-text">{editor.original?.source?.kind === 'text' ? '保留原文来源；失效的原文不能通过编辑恢复有效。' : '本次保存记录为作者决定。未知的时间和知情继续保持未知。'}</p>
      {editor.version !== data.project.version && <Banner>作品版本已改变，输入保留，请复制后基于新版本重开。</Banner>}<div className="dialog-actions"><Button onClick={close}>取消</Button><Button type="submit" variant="primary" disabled={busy || editor.version !== data.project.version}>保存故事记录</Button></div>
    </form></Dialog>}
    {order && <Dialog title="设置事件先后" onClose={close}><Field label="先发生的事件"><select value={order.before} onChange={e => setOrder({ ...order, before: e.target.value })}>{eventOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field><Field label="后发生的事件"><select value={order.after} onChange={e => setOrder({ ...order, after: e.target.value })}>{eventOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field><div className="dialog-actions"><Button disabled={busy || !order.before || !order.after || order.version !== data.project.version} onClick={() => void action({ action: 'story-save', story: { ...story, order: [...story.order, { before: order.before, after: order.after }] } }, order.version).then(() => { setOrder(null); notify('事件先后已保存。'); }).catch(() => undefined)}>保存事件顺序</Button></div></Dialog>}
    {source?.kind === 'text' ? <SourceDialog workspace={data.project.id} reference={source} onClose={() => setSource(null)}/> : source && <Dialog title="故事来源" onClose={() => setSource(null)}><p>{source.kind === 'author' ? `作者决定：${source.decisionId}` : `计划修订：${source.revisionId}`}</p><p className="help-text">通过版本与导出查看当时的作品快照。</p></Dialog>}
  </div>;
}
