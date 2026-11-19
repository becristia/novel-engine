import { useEffect, useRef } from 'react';
import type { Reference } from '../src/domain/review.js';
import type { ContextSnapshot } from '../src/context/builder.js';
import type { RevisionView } from './model.js';
import { workspacePath } from './model.js';
import { useResource } from './hooks.js';
import { Badge, Dialog, ErrorText, Icon } from './components.js';

export function Manuscript({ revision, title, reference, locked = [], onLock, onUnlock }: { revision: RevisionView; title: string; reference?: Reference | undefined; locked?: { id?: string; start: number; end: number }[]; onLock?: ((blockId: string) => void) | undefined; onUnlock?: ((id: string) => void) | undefined }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (reference?.revisionId === revision.id) ref.current?.querySelector(`[data-block="${reference.blockId}"]`)?.scrollIntoView({ block: 'nearest' }); }, [reference, revision.id]);
  const startsWithTitle = /^##\s/u.test(revision.blocks[0]?.text ?? '');
  return <div className="manuscript" ref={ref}>{!startsWithTitle && <h2 className="manuscript-title">{title}</h2>}{revision.blocks.map(block => {
    const heading = /^##\s/u.test(block.text); const selected = reference?.revisionId === revision.id && reference.blockId === block.id;
    const start = selected && reference?.start !== undefined ? reference.start - block.start : -1;
    const end = selected && reference?.end !== undefined ? reference.end - block.start : -1;
    const text = start >= 0 && end > start ? <>{block.text.slice(0, start)}<mark>{block.text.slice(start, end)}</mark>{block.text.slice(end)}</> : block.text;
    const lock = locked.find(lock => lock.start < block.end && lock.end > block.start); const isLocked = Boolean(lock);
    return <div key={block.id} data-block={block.id} className={`manuscript-block ${selected ? 'highlighted' : ''} ${isLocked ? 'locked' : ''}`}>
      {heading ? <h2 className="manuscript-title">{block.text.replace(/^##\s+/u, '')}</h2> : <p>{text}</p>}
      {isLocked && <span className="block-lock" title="此段已锁定">{onUnlock && lock?.id ? <button type="button" aria-label={`解除段落 ${block.id} 的锁定`} onClick={() => onUnlock(lock.id!)}><Icon name="lock" size={15}/></button> : <Icon name="lock" size={15}/>}</span>}
      {onLock && !heading && !isLocked && <button className="lock-control" type="button" aria-label={`锁定段落 ${block.id}`} onClick={() => onLock(block.id)}><Icon name="lock" size={16}/></button>}
    </div>;
  })}</div>;
}

export function SourceDialog({ workspace, reference, onClose }: { workspace: string; reference: Reference; onClose: () => void }) {
  const source = useResource<RevisionView>(workspacePath(workspace, `revisions/${reference.revisionId}`));
  return <Dialog title="原文证据" onClose={onClose}><p className="help-text">显示引用所绑定的正文版本。</p>{source.error ? <ErrorText error={source.error}/> : source.value ? <Manuscript revision={source.value} title="来源正文" reference={reference}/> : <p>正在读取原文…</p>}</Dialog>;
}

const sourceNames = { constraint: '作者约束', plan: '本章计划', chapter: '正式正文', fact: '确认事实', summary: '章节摘要', 'story-claim': '场景认知', 'story-rule': '写作规则', 'story-thread': '到期伏笔', 'story-scene': '场景指令', 'story-state': '故事状态', 'text-range': '原文片段' };
export function contextText(source: ContextSnapshot['sources'][number]): string {
  if (source.kind === 'constraint') return (JSON.parse(source.text) as string[]).join('；') || '未设置独立约束';
  if (source.kind === 'plan') { const plan = JSON.parse(source.text) as { title: string; goal: string }; return `${plan.title}：${plan.goal}`; }
  if (source.kind === 'fact' || source.kind === 'story-claim') { const fact = JSON.parse(source.text) as { subject: string; relation: string; value: string }; return `${fact.subject} · ${fact.value}`; }
  if (source.kind === 'story-scene') { const scene = JSON.parse(source.text) as { goal: string; instructions: string[] }; return [scene.goal, ...scene.instructions].join('；'); }
  return source.text;
}
export function ContextList({ context }: { context: ContextSnapshot }) {
  const omissions = context.omissions ?? [];
  return <div className="context-list"><p className="help-text">当前输入保守估算 {context.estimatedTokens.toLocaleString()} token；最终用量以供应商返回为准。</p>{context.sources.map((source, i) => {
    const kind = source.kind === 'fact' || source.kind === 'story-claim' ? (JSON.parse(source.text) as { kind: string }).kind : null;
    const label = kind === 'belief' ? '角色误信' : kind === 'plan' ? '未来计划' : sourceNames[source.kind];
    return <details className="source-item" key={`${source.id}:${i}`}><summary><Badge>{label}</Badge><span>{contextText(source).slice(0, 65)}</span><Badge tone="green">已采用</Badge></summary><p className="help-text">{source.reason}</p><div className="source-text">{contextText(source)}</div></details>;
  })}{omissions.length > 0 && <details className="source-item"><summary>省略了 {omissions.length} 项来源</summary>{omissions.map((item, index) => <p className="help-text" key={index}>{({ budget: '超出本次上下文预算', 'source-not-fresh': '来源或依赖已失效', unconfirmed: '尚未经过作者确认', 'not-disclosed': '未允许在本场景披露', 'knowledge-unknown-or-not-yet': '人物获知时间未知或尚未到达', 'outside-story-time-or-unknown': '故事时间不适用或无法比较', 'not-established': '计划或推测不能当作事实', 'other-character-belief': '属于其他人物的想法', 'whole-chapter-and-summary-unscoped': '整章或摘要未标注可见范围', 'mixed-visibility': '片段混有当前不可用信息', 'staff-only': '仅供规划与审查', 'event-not-established': '相关事件未确定发生' } as Record<string, string>)[item.reason] ?? '未命中本章人物或别名'}</p>)}</details>}</div>;
}
