import { cloneElement, isValidElement, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { formatHumanText } from '../src/cli/format.js';

const paths: Record<string, ReactNode> = {
  book: <><path d="M12 5c-3-3-7-3-10-1v16c3-2 7-2 10 1 3-3 7-3 10-1V4c-3-2-7-2-10 1Z"/><path d="M12 5v16"/></>,
  file: <><path d="M5 2h9l5 5v15H5Z"/><path d="M14 2v6h5M8 12h8M8 16h8"/></>,
  list: <><path d="M8 5h13M8 12h13M8 19h13"/><path d="M3 5h.1M3 12h.1M3 19h.1"/></>,
  memory: <><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 4 18 4 18 0V5M3 12c0 4 18 4 18 0"/></>,
  edit: <><path d="m15 3 6 6-12 12-7 1 1-7ZM13 5l6 6"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  task: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m7 12 3 3 7-7"/></>,
  export: <><path d="M12 16V2m-5 5 5-5 5 5M3 12v9h18v-9"/></>,
  settings: <><path d="m9 3 1-2h4l1 3 3 1 3 1 1 4-2 2v3l1 3-3 3-3-1-3 1-2 2-4-2v-3l-2-2-3-1v-4l3-1 2-3V4Z"/><circle cx="12" cy="12" r="3"/></>,
  arrow: <path d="m9 5 7 7-7 7"/>, down: <path d="m5 9 7 7 7-7"/>,
  plus: <path d="M12 4v16M4 12h16"/>, close: <path d="m5 5 14 14M5 19 19 5"/>,
  search: <><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
  lock: <><rect x="4" y="10" width="16" height="12" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 15v3"/></>,
  warning: <><circle cx="12" cy="12" r="10"/><path d="M12 6v7m0 4h.01"/></>,
  refresh: <><path d="M20 8a9 9 0 1 0 1 7M20 2v6h-6"/></>,
  user: <><circle cx="12" cy="7" r="4"/><path d="M3 22v-4c0-7 18-7 18 0v4Z"/></>,
};
export function Icon({ name, size = 22 }: { name: string; size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.file}</svg>; }
export function Button({ children, variant = 'secondary', icon, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; icon?: string }) {
  return <button type="button" {...props} className={`button ${variant} ${props.className ?? ''}`}>{icon && <Icon name={icon} size={19}/>}<span>{typeof children === 'string' ? formatHumanText(children) : children}</span></button>;
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'red' }) { return <span className={`badge ${tone}`}>{children}</span>; }
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) { return <header className="page-header"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div><div className="header-actions">{actions}</div></header>; }
export function Panel({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) { return <section className={`panel ${className}`}>{title && <h2>{title}</h2>}{children}</section>; }
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const generated = useId();
  const control = isValidElement<{ id?: string; 'aria-describedby'?: string }>(children) ? children : null;
  const id = control?.props.id ?? generated;
  return <div className="field"><label className="field-label" htmlFor={id}>{formatHumanText(label)}</label>{control ? cloneElement(control, { id, ...(hint ? { 'aria-describedby': `${id}-hint` } : {}) }) : children}{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}
export function TagsInput({ value, onChange, disabled, id }: { value: string[]; onChange: (value: string[]) => void; disabled?: boolean; id?: string }) {
  const [draft, setDraft] = useState('');
  const add = () => { const next = draft.split(/[，,]/u).map(s => s.trim()).filter(Boolean); if (next.length) onChange([...new Set([...value, ...next])]); setDraft(''); };
  return <div className={`tags-input ${disabled ? 'disabled' : ''}`}>{value.map(item => <span key={item}>{item}{!disabled && <button type="button" aria-label={`移除人物 ${item}`} onClick={() => onChange(value.filter(v => v !== item))}><Icon name="close" size={13}/></button>}</span>)}<input id={id} disabled={disabled} value={draft} placeholder={disabled ? '' : '添加人物'} onChange={e => setDraft(e.target.value)} onBlur={add} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}/></div>;
}
export function Empty({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) { return <div className="empty-state"><Icon name="book" size={42}/><h2>{title}</h2>{detail && <p>{detail}</p>}{children}</div>; }
export function Banner({ children, tone = 'amber' }: { children: ReactNode; tone?: 'amber' | 'red' | 'green' | 'neutral' }) { return <div className={`banner ${tone}`}><Icon name={tone === 'green' ? 'check' : 'warning'} size={21}/><div>{children}</div></div>; }
export function Tabs({ items, value, onChange }: { items: { value: string; label: string; count?: number }[]; value: string; onChange: (value: string) => void }) {
  return <div className="tabs" role="tablist">{items.map((item, index) => <button role="tab" type="button" aria-selected={item.value === value} tabIndex={item.value === value ? 0 : -1} key={item.value} className={item.value === value ? 'selected' : ''} onClick={() => onChange(item.value)} onKeyDown={event => {
    const next = event.key === 'ArrowRight' ? (index + 1) % items.length : event.key === 'ArrowLeft' ? (index + items.length - 1) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); onChange(items[next]!.value); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
  }}>{item.label}{item.count !== undefined && <small>{item.count}</small>}</button>)}</div>;
}
export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!; const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal(); dialog.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled]), select:not([disabled])')?.focus();
    return () => { dialog.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);
  return <dialog ref={ref} className="dialog" onCancel={event => { event.preventDefault(); onClose(); }} aria-label={title}><header><h2>{title}</h2><Button variant="ghost" icon="close" aria-label="关闭对话框" onClick={onClose}/></header>{children}</dialog>;
}
export function ErrorText({ error }: { error: unknown }) { return <Banner tone="red">{error instanceof Error ? formatHumanText(error.message) : '无法读取内容，请重试。'}</Banner>; }
