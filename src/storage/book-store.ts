import { randomUUID } from 'node:crypto';
import { BookStateSchema, hash } from '../domain/workspace.js';
import type { BookState, Revision, Snapshot } from '../domain/workspace.js';
import { WorkspaceDatabase } from './database.js';

export class BookStore extends WorkspaceDatabase {
  initialize(title: string): void {
    if (!title.trim()) throw new Error('作品标题不能为空。');
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO project VALUES (?, ?, ?, 0)').run(randomUUID(), title, 'zh-CN');
      this.db.prepare('INSERT INTO snapshots VALUES (0, ?, ?)').run(JSON.stringify({ chapters: [], constraints: [] }), new Date().toISOString());
    }).immediate();
  }

  project(): { id: string; title: string; language: string; version: number } {
    const row = this.db.prepare('SELECT * FROM project').get() as { id: string; title: string; language: string; version: number } | undefined;
    if (!row) throw new Error('工作区未完成初始化。');
    return row;
  }

  snapshot(version = this.project().version): Snapshot {
    const row = this.db.prepare('SELECT state FROM snapshots WHERE version = ?').get(version) as { state: string } | undefined;
    if (!row) throw new Error('指定的项目版本不存在。');
    return { version, state: BookStateSchema.parse(JSON.parse(row.state)) };
  }

  revision(id: string): Revision {
    const row = this.db.prepare('SELECT id, chapter_id AS chapterId, parent_id AS parentId, content, content_hash AS contentHash, run_id AS runId FROM revisions WHERE id = ?').get(id) as Revision | undefined;
    if (!row) throw new Error('正文版本不存在。');
    if (hash(row.content) !== row.contentHash) throw new Error('正文校验失败，请保留工作区并检查备份。');
    return row;
  }

  insertRevision(chapterId: string, content: string, parentId: string | null = null, runId: string | null = null): Revision {
    if (parentId !== null && this.revision(parentId).chapterId !== chapterId) throw new Error('正文父版本必须属于同一章节。');
    const revision = { id: randomUUID(), chapterId, parentId, content, contentHash: hash(content), runId };
    this.db.prepare('INSERT INTO revisions VALUES (?, ?, ?, ?, ?, ?)').run(revision.id, chapterId, parentId, content, revision.contentHash, runId);
    return revision;
  }

  commit(expectedVersion: number, requestId: string, fingerprint: string, mutate: (state: BookState) => void): Snapshot {
    return this.db.transaction(() => {
      const previous = this.db.prepare('SELECT fingerprint, version FROM commits WHERE request_id = ?').get(requestId) as { fingerprint: string; version: number } | undefined;
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new Error('同一请求身份不能用于不同内容。');
        return this.snapshot(previous.version);
      }
      const current = this.snapshot();
      if (current.version !== expectedVersion) throw new Error('项目版本冲突，请基于最新版本重新操作。');
      const before = structuredClone(current.state);
      mutate(current.state);
      const state = BookStateSchema.parse(current.state);
      if (new Set(state.chapters.map(chapter => chapter.id)).size !== state.chapters.length) throw new Error('章节身份重复。');
      for (const chapter of state.chapters) {
        if (this.revision(chapter.revisionId).chapterId !== chapter.id) throw new Error('章节与正文版本不匹配。');
      }
      for (const lock of before.locks) {
        const kept = state.locks.find(item => item.id === lock.id);
        if (!kept) continue;
        const chapter = state.chapters.find(item => item.id === lock.chapterId);
        if (!chapter || kept.quote !== lock.quote || kept.chapterId !== lock.chapterId || kept.revisionId !== chapter.revisionId) throw new Error('存在锁定范围，请使用受检查的局部提案，或由作者显式解锁。');
        const revision = this.revision(chapter.revisionId);
        if (kept.contentHash !== revision.contentHash || revision.content.slice(kept.start, kept.end) !== lock.quote) throw new Error('锁定内容发生变化，提交已拒绝。');
      }
      const appendOnly = before.chapters.every((chapter, index) => state.chapters[index]?.id === chapter.id && state.chapters[index]?.revisionId === chapter.revisionId);
      if (!appendOnly || JSON.stringify(before.constraints) !== JSON.stringify(state.constraints)) {
        this.db.prepare("UPDATE memory_entries SET status = 'stale' WHERE status = 'fresh'").run();
        this.db.prepare("UPDATE memory_sources SET status = 'stale' WHERE status = 'fresh'").run();
        state.confirmedFactIds = [];
      }
      for (const chapter of state.chapters) {
        this.db.prepare("UPDATE memory_entries SET status = 'fresh' WHERE revision_id = ? AND status = 'pending'").run(chapter.revisionId);
        this.db.prepare("UPDATE memory_sources SET status = 'fresh' WHERE revision_id = ? AND status = 'pending'").run(chapter.revisionId);
        const confirmed = this.db.prepare("SELECT id FROM memory_entries WHERE revision_id = ? AND kind = 'fact' AND status = 'fresh' AND confirmed = 1").all(chapter.revisionId) as { id: string }[];
        state.confirmedFactIds.push(...confirmed.map(item => item.id));
      }
      state.confirmedFactIds = [...new Set(state.confirmedFactIds)];
      const next = current.version + 1;
      this.db.prepare('INSERT INTO snapshots VALUES (?, ?, ?)').run(next, JSON.stringify(state), new Date().toISOString());
      const changed = this.db.prepare('UPDATE project SET version = ? WHERE version = ?').run(next, expectedVersion);
      if (changed.changes !== 1) throw new Error('项目版本冲突。');
      this.db.prepare('INSERT INTO commits VALUES (?, ?, ?)').run(requestId, fingerprint, next);
      return { version: next, state };
    }).immediate();
  }
}
