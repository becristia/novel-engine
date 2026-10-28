import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BookStore } from '../src/storage/book-store.js';
import { CommitService, createWorkspace } from '../src/application/workspace.js';
import { decodeManuscript } from '../src/application/manuscript.js';
import { runCli } from '../src/cli/program.js';

describe('versioned workspace', () => {
  let directory: string;
  let store: BookStore;
  let service: CommitService;
  beforeEach(async () => {
    await mkdir('.tmp/milestone-tests', { recursive: true });
    directory = await mkdtemp(resolve('.tmp/milestone-tests/workspace-'));
    createWorkspace(directory, '港口旧灯');
    store = new BookStore(directory);
    service = new CommitService(store);
  });
  afterEach(async () => {
    if (store?.db.open) store.close();
    if (directory) await rm(directory, { recursive: true });
  });

  it('previews without mutation, preserves source bytes, and deduplicates imports', async () => {
    const file = 'fixtures/novels/harbor-light.md';
    expect((await service.importFile(file, false)).chapters).toHaveLength(3);
    expect(store.project().version).toBe(0);
    const imported = await service.importFile(file, true);
    expect(imported.version).toBe(1);
    expect((await service.importFile(file, true)).duplicate).toBe(true);
    expect(store.project().version).toBe(1);
    expect(service.exportText(1)).toBe(await readFile(file, 'utf8'));
    const row = store.db.prepare('SELECT raw FROM imports').get() as { raw: Buffer };
    expect(row.raw).toEqual(await readFile(file));
  });

  it('restores old membership, ordering and text after replacement, insertion and reorder', async () => {
    await service.importFile('fixtures/novels/harbor-light.md', true);
    const original = service.exportText(1);
    const first = store.snapshot().state.chapters[0]!;
    service.replace(first.id, '## 新第一章\n修改后的正文。\n', 1);
    service.insert('插章', '## 插章\n一封旧信。\n', 2, 2);
    const ids = store.snapshot().state.chapters.map(chapter => chapter.id).reverse();
    service.reorder(ids, 3);
    expect(store.snapshot(1).state.chapters).toHaveLength(3);
    expect(store.snapshot(4).state.chapters.map(chapter => chapter.id)).toEqual(ids);
    expect(service.exportText(1)).toBe(original);
    expect(service.exportText(4)).toContain('修改后的正文');
    expect(service.exportText(0)).toBe('');
  });

  it('rejects stale writes from another connection without orphan revisions', async () => {
    await service.importFile('fixtures/novels/harbor-light.md', true);
    const other = new BookStore(directory);
    try {
      const id = store.snapshot().state.chapters[0]!.id;
      service.replace(id, '新正文。', 1);
      expect(() => new CommitService(other).replace(id, '旧进程正文。', 1)).toThrow('版本冲突');
      expect(store.db.prepare('SELECT count(*) AS n FROM revisions').get()).toEqual({ n: 4 });
    } finally { other.close(); }
  });

  it('replays the same commit idempotently and rejects changed parameters', async () => {
    await service.importFile('fixtures/novels/harbor-light.md', true);
    const id = store.snapshot().state.chapters[0]!.id;
    expect(service.replace(id, '新正文。', 1, 'same-request').version).toBe(2);
    expect(service.replace(id, '新正文。', 1, 'same-request').version).toBe(2);
    expect(() => service.replace(id, '不同正文。', 1, 'same-request')).toThrow('不同内容');
  });

  it('rejects changes to immutable revisions and snapshots', async () => {
    await service.importFile('fixtures/novels/harbor-light.md', true);
    expect(() => store.db.exec("UPDATE revisions SET content = 'wrong'")).toThrow('immutable');
    expect(() => store.db.exec('DELETE FROM snapshots')).toThrow('immutable');
  });

  it('does not attach a revision to another chapter as its parent', async () => {
    await service.importFile('fixtures/novels/harbor-light.md', true);
    const [first, second] = store.snapshot().state.chapters;
    expect(() => store.insertRevision(first!.id, '正文。', second!.revisionId)).toThrow('同一章节');
  });

  it('does not overwrite existing export files', async () => {
    const target = join(directory, 'export.md');
    await writeFile(target, '原有稿件');
    await expect(service.exportFile(target)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(target, 'utf8')).toBe('原有稿件');
  });

  it('treats export --version as the project version, not the application version', async () => {
    await service.importFile('fixtures/novels/harbor-light.md', true);
    const target = join(directory, 'cli-export.md');
    let output = '';
    const code = await runCli(['--project', directory, 'export', '--version', '1', '--out', target], {
      stdout: text => { output += text; }, stderr: text => { output += text; },
    });
    expect(code).toBe(0);
    expect(output).toContain('exported');
    expect(await readFile(target, 'utf8')).toBe(service.exportText(1));
  });

  it('refuses future database versions without changing stored data', async () => {
    store.db.pragma('user_version = 999');
    expect(() => new BookStore(directory)).toThrow('版本高于');
    expect(store.db.pragma('user_version', { simple: true })).toBe(999);
    expect(store.project().title).toBe('港口旧灯');
  });

  it('rejects changed source files instead of silently duplicating chapters', async () => {
    const source = join(directory, 'input.md');
    await writeFile(source, '初稿。');
    await service.importFile(source, true);
    await writeFile(source, '修改稿。');
    await expect(service.importFile(source, true)).rejects.toThrow('同一来源');
  });

  it('normalizes newlines and detects invalid input encodings', () => {
    expect(decodeManuscript(Buffer.from('正文。\r\n'))).toEqual({ encoding: 'utf-8', text: '正文。\n' });
    expect(() => decodeManuscript(Buffer.from([0xc3, 0x28]))).toThrow('编码无效');
    expect(() => decodeManuscript(Buffer.from('   '))).toThrow('稿件为空');
  });
});
