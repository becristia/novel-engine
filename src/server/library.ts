import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { BookStore } from '../storage/book-store.js';
import { createWorkspace } from '../application/workspace.js';
import { HttpError } from '../application/workbench-errors.js';

const RegistrySchema = z.strictObject({ schemaVersion: z.literal(1), entries: z.array(z.strictObject({ id: z.string(), directory: z.string() })) });
export class Library {
  readonly root: string;
  private readonly file: string;
  private readonly entries: { id: string; directory: string }[];
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.root = realpathSync(directory); this.file = resolve(this.root, '.workbench.json');
    this.entries = existsSync(this.file) ? RegistrySchema.parse(JSON.parse(readFileSync(this.file, 'utf8'))).entries : [];
  }
  private check(directory: string): string {
    const resolved = resolve(this.root, directory);
    const canonical = existsSync(resolved) ? realpathSync(resolved) : resolve(realpathSync(dirname(resolved)), basename(resolved));
    const path = relative(this.root, canonical);
    if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new HttpError(403, 'outside-library', '工作区必须位于启动时指定的作品目录内。');
    return canonical;
  }
  path(id: string): string {
    const entry = this.entries.find(item => item.id === id);
    if (!entry) throw new HttpError(404, 'workspace-not-found', '未登记该工作区，请先打开作品。');
    return this.check(entry.directory);
  }
  open(directory: string, title?: string) {
    const target = this.check(directory);
    if (title !== undefined) createWorkspace(target, title);
    const book = new BookStore(target);
    try {
      const project = book.project();
      const existing = this.entries.find(item => item.directory === target);
      if (!existing) {
        this.entries.push({ id: project.id, directory: target });
        const temporary = `${this.file}.${randomUUID()}`;
        writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, entries: this.entries }), { mode: 0o600, flag: 'wx' });
        renameSync(temporary, this.file);
      }
      return this.summary(existing?.id ?? project.id);
    } finally { book.close(); }
  }
  summary(id: string) {
    const book = new BookStore(this.path(id), false, true);
    try { return { ...book.project(), directory: relative(this.root, book.directory), chapterCount: book.snapshot().state.chapters.length }; }
    finally { book.close(); }
  }
  list() { return this.entries.map(item => this.summary(item.id)); }
}
