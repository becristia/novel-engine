import type { z } from 'zod';
import type { ScenePlanSchema } from '../src/domain/planning.js';
import type { StoryState } from '../src/domain/story-memory.js';
import { Button, Field, Panel } from './components.js';

type ScenePlan = z.infer<typeof ScenePlanSchema>;
export function ScenePlanEditor({ scenes, onChange, story, disabled }: { scenes: ScenePlan[]; onChange: (scenes: ScenePlan[]) => void; story: StoryState; disabled: boolean }) {
  const update = (index: number, value: Partial<ScenePlan>) => onChange(scenes.map((scene, i) => i === index ? { ...scene, ...value } : scene));
  return <div className="stack story-plan-editor"><div className="row-title"><h3>场景与披露安排</h3><Button disabled={disabled || scenes.length >= 12} onClick={() => onChange([...scenes, { id: crypto.randomUUID(), title: `场景 ${scenes.length + 1}`, goal: '', instructions: [], narration: 'limited', viewpointCharacter: null, eventId: null, revealClaimIds: [], threadIds: [] }])}>添加场景</Button></div>
    {!scenes.length && <p className="help-text">添加场景后将按场景顺序写作，整章批准。时间未知不会从章号推断。</p>}
    {scenes.map((scene, index) => <Panel key={scene.id}><h3>场景 {index + 1}</h3><Field label={`场景 ${index + 1} 标题`}><input disabled={disabled} value={scene.title} onChange={e => update(index, { title: e.target.value })}/></Field>
      <Field label={`场景 ${index + 1} 目标`} hint="只写当前视角可使用的执行目标。"><textarea disabled={disabled} value={scene.goal} onChange={e => update(index, { goal: e.target.value })}/></Field>
      <div className="field-row"><Field label={`场景 ${index + 1} 叙述方式`}><select disabled={disabled} value={scene.narration} onChange={e => update(index, { narration: e.target.value as ScenePlan['narration'] })}><option value="limited">有限视角</option><option value="omniscient">全知叙述</option><option value="unreliable">不可靠叙述</option></select></Field><Field label={`场景 ${index + 1} 视角人物`}><input disabled={disabled} value={scene.viewpointCharacter ?? ''} onChange={e => update(index, { viewpointCharacter: e.target.value || null })}/></Field></div>
      <Field label={`场景 ${index + 1} 故事位置`}><select disabled={disabled} value={scene.eventId ?? ''} onChange={e => update(index, { eventId: e.target.value || null })}><option value="">未知时间</option>{story.events.map(event => <option key={event.id} value={event.id}>{event.title}</option>)}</select></Field>
      <Field label={`场景 ${index + 1} 安全指令`}><textarea disabled={disabled} value={scene.instructions.join('\n')} onChange={e => update(index, { instructions: e.target.value.split('\n').filter(Boolean) })}/></Field>
      {!!story.claims.length && <fieldset disabled={disabled}><legend>本场景允许揭示</legend>{story.claims.filter(claim => claim.status === 'fresh').map(claim => <label className="check-label" key={claim.id}><input type="checkbox" checked={scene.revealClaimIds.includes(claim.id)} onChange={e => update(index, { revealClaimIds: e.target.checked ? [...scene.revealClaimIds, claim.id] : scene.revealClaimIds.filter(id => id !== claim.id) })}/>{story.entities.find(item => item.id === claim.subjectId)?.name}：{claim.value}</label>)}</fieldset>}
      {!!story.threads.length && <fieldset disabled={disabled}><legend>本场景处理的伏笔</legend>{story.threads.map(thread => <label className="check-label" key={thread.id}><input type="checkbox" checked={scene.threadIds.includes(thread.id)} onChange={e => update(index, { threadIds: e.target.checked ? [...scene.threadIds, thread.id] : scene.threadIds.filter(id => id !== thread.id) })}/>{thread.title}</label>)}</fieldset>}
      <Button disabled={disabled || index === 0} onClick={() => { const next = [...scenes]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; onChange(next); }}>场景上移</Button>
    </Panel>)}
  </div>;
}
