import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { hash, normalizeText } from '../domain/workspace.js';
import type { Snapshot } from '../domain/workspace.js';
import { BookStore } from '../storage/book-store.js';
import { decodeManuscript, splitChapters } from './manuscript.js';

export function createWorkspace(directory: string, title: string): void {
  if (!title.trim()) throw new Error('作品标题不能为空。');
  const store = new BookStore(directory, true);
  try { store.initialize(title); } finally { store.close(); }
}

export class CommitService {
  constructor(readonly store: BookStore) {}

  async importFile(file: string, apply: boolean): Promise<{ chapters: { title: string; characters: number }[]; encoding: string; version: number; duplicate: boolean }> {
    const raw = await readFile(file);
    return this.importBytes(raw, resolve(file), apply);
  }

  importBytes(raw: Buffer, source: string, apply: boolean, expectedVersion = this.store.project().version) {
    const { text, encoding } = decodeManuscript(raw);
    const chapters = splitChapters(text);
    const digest = hash(raw);
    const previous = this.store.db.prepare('SELECT content_hash, version FROM imports WHERE source = ? OR content_hash = ?').get(source, digest) as { content_hash: string; version: number } | undefined;
    if (previous && previous.content_hash !== digest) throw new Error('同一来源已导入且内容不同，请使用 chapter replace 明确修改章节。');
    const report = { chapters: chapters.map(chapter => ({ title: chapter.title, characters: [...chapter.content].length })), encoding, version: this.store.project().version, duplicate: Boolean(previous) };
    if (!apply || previous) return report;
    const snapshot = this.store.commit(expectedVersion, `import:${digest}`, digest, state => {
      for (const chapter of chapters) {
        const id = randomUUID();
        const revision = this.store.insertRevision(id, chapter.content);
        state.chapters.push({ id, title: chapter.title, revisionId: revision.id });
      }
      this.store.db.prepare('INSERT INTO imports VALUES (?, ?, ?, ?, ?)').run(source, digest, raw, encoding, report.version + 1);
    });
    return { ...report, version: snapshot.version };
  }

  replace(chapterId: string, content: string, expectedVersion: number, requestId: string = randomUUID()): Snapshot {
    if (!content.trim()) throw new Error('替换正文不能为空。');
    const normalized = normalizeText(content);
    return this.store.commit(expectedVersion, requestId, hash(JSON.stringify({ chapterId, normalized, expectedVersion })), state => {
      const chapter = state.chapters.find(item => item.id === chapterId);
      if (!chapter) throw new Error('章节不存在。');
      chapter.revisionId = this.store.insertRevision(chapterId, normalized, chapter.revisionId).id;
    });
  }

  insert(title: string, content: string, position: number, expectedVersion: number): Snapshot {
    if (!title.trim() || !content.trim()) throw new Error('章节标题和正文不能为空。');
    return this.store.commit(expectedVersion, randomUUID(), hash(JSON.stringify({ title, content, position })), state => {
      if (!Number.isSafeInteger(position) || position < 1 || position > state.chapters.length + 1) throw new Error('插入位置超出章节范围。');
      const id = randomUUID();
      const revision = this.store.insertRevision(id, normalizeText(content));
      state.chapters.splice(position - 1, 0, { id, title, revisionId: revision.id });
    });
  }

  reorder(ids: string[], expectedVersion: number): Snapshot {
    return this.store.commit(expectedVersion, randomUUID(), hash(JSON.stringify(ids)), state => {
      if (ids.length !== state.chapters.length || new Set(ids).size !== ids.length || ids.some(id => !state.chapters.some(chapter => chapter.id === id))) throw new Error('排序必须包含每个现有章节且只能出现一次。');
      state.chapters = ids.map(id => state.chapters.find(chapter => chapter.id === id)!);
    });
  }

  exportText(version?: number, format: 'markdown' | 'txt' = 'markdown'): string {
    const snapshot = this.store.snapshot(version);
    let output = '';
    for (const chapter of snapshot.state.chapters) {
      let content = this.store.revision(chapter.revisionId).content;
      if (format === 'txt') content = content.replace(/^##[ \t]+/gmu, '');
      if (output && !output.endsWith('\n')) output += '\n';
      output += content;
    }
    return output;
  }

  async exportFile(file: string, version?: number, format: 'markdown' | 'txt' = 'markdown'): Promise<void> {
    await mkdir(dirname(resolve(file)), { recursive: true });
    // Never overwrite a manuscript or an existing export implicitly.
    await writeFile(file, this.exportText(version, format), { encoding: 'utf8', flag: 'wx' });
  }
}
