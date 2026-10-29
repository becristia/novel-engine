import { useEffect, useRef } from 'react';
import type { Reference } from '../src/domain/review.js';
import type { ContextSnapshot } from '../src/context/builder.js';
import type { RevisionView } from './model.js';
import { workspacePath } from './model.js';
import { useResource } from './hooks.js';
import { Badge, Dialog, ErrorText, Icon } from './components.js';

export function Manuscript({ revision, title, reference, locked = [], onLock }: { revision: RevisionView; title: string; reference?: Reference | undefined; locked?: { start: number; end: number }[]; onLock?: (blockId: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (reference?.revisionId === revision.id) ref.current?.querySelector(`[data-block="${reference.blockId}"]`)?.scrollIntoView({ block: 'nearest' }); }, [reference, revision.id]);
  const startsWithTitle = /^##\s/u.test(revision.blocks[0]?.text ?? '');
  return <div className="manuscript" ref={ref}>{!startsWithTitle && <h2 className="manuscript-title">{title}</h2>}{revision.blocks.map(block => {
    const heading = /^##\s/u.test(block.text); const selected = reference?.revisionId === revision.id && reference.blockId === block.id;
    const start = selected && reference?.start !== undefined ? reference.start - block.start : -1;
    const end = selected && reference?.end !== undefined ? reference.end - block.start : -1;
    const text = start >= 0 && end > start ? <>{block.text.slice(0, start)}<mark>{block.text.slice(start, end)}</mark>{block.text.slice(end)}</> : block.text;
    const isLocked = locked.some(lock => lock.start < block.end && lock.end > block.start);
    return <div key={block.id} data-block={block.id} className={`manuscript-block ${selected ? 'highlighted' : ''} ${isLocked ? 'locked' : ''}`}>
      {heading ? <h2 className="manuscript-title">{block.text.replace(/^##\s+/u, '')}</h2> : <p>{text}</p>}
      {isLocked && <span className="block-lock" title="此段已锁定"><Icon name="lock" size={15}/></span>}
      {onLock && !heading && !isLocked && <button className="lock-control" type="button" aria-label={`锁定段落 ${block.id}`} onClick={() => onLock(block.id)}><Icon name="lock" size={16}/></button>}
    </div>;
  })}</div>;
}

export function SourceDialog({ workspace, reference, onClose }: { workspace: string; reference: Reference; onClose: () => void }) {
  const source = useResource<RevisionView>(workspacePath(workspace, `revisions/${reference.revisionId}`));
  return <Dialog title="原文证据" onClose={onClose}><p className="help-text">显示引用所绑定的正文版本。</p>{source.error ? <ErrorText error={source.error}/> : source.value ? <Manuscript revision={source.value} title="来源正文" reference={reference}/> : <p>正在读取原文…</p>}</Dialog>;
}

const sourceNames = { constraint: '作者约束', plan: '本章计划', chapter: '正式正文', fact: '确认事实', summary: '章节摘要' };
export function contextText(source: ContextSnapshot['sources'][number]): string {
  if (source.kind === 'constraint') return (JSON.parse(source.text) as string[]).join('；') || '未设置独立约束';
  if (source.kind === 'plan') { const plan = JSON.parse(source.text) as { title: string; goal: string }; return `${plan.title}：${plan.goal}`; }
  if (source.kind === 'fact') { const fact = JSON.parse(source.text) as { subject: string; relation: string; value: string }; return `${fact.subject} · ${fact.value}`; }
  return source.text;
}
export function ContextList({ context }: { context: ContextSnapshot }) {
  const omissions = context.omissions ?? [];
  return <div className="context-list"><p className="help-text">当前输入保守估算 {context.estimatedTokens.toLocaleString()} token；最终用量以供应商返回为准。</p>{context.sources.map((source, i) => <details className="source-item" key={`${source.id}:${i}`}><summary><Badge>{sourceNames[source.kind]}</Badge><span>{contextText(source).slice(0, 65)}</span><Badge tone="green">已采用</Badge></summary><p className="help-text">{source.reason}</p><div className="source-text">{contextText(source)}</div></details>)}{omissions.length > 0 && <details className="source-item"><summary>省略了 {omissions.length} 项来源</summary>{omissions.map((item, index) => <p className="help-text" key={index}>{item.reason === 'budget' ? '超出本次上下文预算' : '未命中本章人物或别名'}</p>)}</details>}</div>;
}
