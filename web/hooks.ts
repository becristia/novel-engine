import { useEffect, useState } from 'react';
import { api } from './api.js';

export function useResource<T>(path: string | null, version: string | number = '') {
  const key = `${path}:${version}`;
  const [result, setResult] = useState<{ key: string; value: T | null; error: unknown } | null>(null);
  useEffect(() => {
    if (!path) return;
    let active = true;
    void api.get<T>(path).then(value => { if (active) setResult({ key, value, error: null }); }).catch(error => { if (active) setResult({ key, value: null, error }); });
    return () => { active = false; };
  }, [path, key]);
  return { value: path && result?.key === key ? result.value : null, error: path && result?.key === key ? result.error : null, loading: Boolean(path && result?.key !== key) };
}

export function allowNavigation(): boolean { return window.dispatchEvent(new Event('novel:navigate', { cancelable: true })); }
export function useUnsavedChanges(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const navigate = (event: Event) => { if (!window.confirm('有未保存的修改，确定离开吗？')) event.preventDefault(); };
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('novel:navigate', navigate); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('novel:navigate', navigate); window.removeEventListener('beforeunload', unload); };
  }, [dirty]);
}
