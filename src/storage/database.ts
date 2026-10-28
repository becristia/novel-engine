import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const migrations = [
  `CREATE TABLE project (id TEXT PRIMARY KEY, title TEXT NOT NULL, language TEXT NOT NULL, version INTEGER NOT NULL);
   CREATE TABLE snapshots (version INTEGER PRIMARY KEY, state TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE revisions (id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL, parent_id TEXT REFERENCES revisions(id), content TEXT NOT NULL, content_hash TEXT NOT NULL, run_id TEXT);
   CREATE TABLE commits (request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, version INTEGER NOT NULL REFERENCES snapshots(version));
   CREATE TABLE imports (source TEXT PRIMARY KEY, content_hash TEXT UNIQUE NOT NULL, raw BLOB NOT NULL, encoding TEXT NOT NULL, version INTEGER NOT NULL);
   CREATE TRIGGER immutable_revisions_update BEFORE UPDATE ON revisions BEGIN SELECT RAISE(ABORT, 'immutable revision'); END;
   CREATE TRIGGER immutable_revisions_delete BEFORE DELETE ON revisions BEGIN SELECT RAISE(ABORT, 'immutable revision'); END;
   CREATE TRIGGER immutable_snapshots_update BEFORE UPDATE ON snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;
   CREATE TRIGGER immutable_snapshots_delete BEFORE DELETE ON snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;`,
  `CREATE TABLE runs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, base_version INTEGER NOT NULL, input TEXT NOT NULL, config TEXT NOT NULL, budget TEXT NOT NULL, status TEXT NOT NULL, error TEXT, cancelled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
   CREATE TABLE attempts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), step TEXT NOT NULL, input_hash TEXT NOT NULL, prompt TEXT NOT NULL, max_output_tokens INTEGER NOT NULL, reserved_tokens INTEGER NOT NULL, status TEXT NOT NULL, raw TEXT, usage TEXT, estimated_cost REAL, price_version TEXT, error TEXT, started_at TEXT NOT NULL, finished_at TEXT);
   CREATE INDEX attempts_run_step ON attempts(run_id, step);`,
  `CREATE TABLE proposals (id TEXT PRIMARY KEY, kind TEXT NOT NULL, base_version INTEGER NOT NULL, revision_id TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES runs(id), parent_id TEXT REFERENCES proposals(id), created_at TEXT NOT NULL);
   CREATE TRIGGER immutable_proposal_payload BEFORE UPDATE OF kind, base_version, revision_id, payload, run_id, parent_id ON proposals BEGIN SELECT RAISE(ABORT, 'immutable proposal payload'); END;
   CREATE TABLE write_lease (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), run_id TEXT NOT NULL, token TEXT NOT NULL, pid INTEGER NOT NULL, hostname TEXT NOT NULL, expires_at INTEGER NOT NULL);`,
];

export class WorkspaceDatabase {
  readonly db: Database.Database;
  readonly directory: string;

  constructor(directory: string, create = false) {
    this.directory = resolve(directory);
    const file = join(this.directory, 'novel.db');
    if (create && existsSync(file)) throw new Error('工作区已经存在，不能覆盖。');
    if (!create && !existsSync(file)) throw new Error('工作区不存在，请先执行 init。');
    if (create) mkdirSync(this.directory, { recursive: true });
    this.db = new Database(file);
    try {
      const version = this.db.pragma('user_version', { simple: true }) as number;
      if (version > migrations.length) throw new Error('数据库版本高于当前程序，停止打开以保护原数据。');
      if (!create && version === 0) throw new Error('文件不是有效的小说工作区。');
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('busy_timeout = 5000');
      this.db.transaction(() => {
        for (let index = version; index < migrations.length; index += 1) {
          this.db.exec(migrations[index]!);
          this.db.pragma(`user_version = ${index + 1}`);
        }
      }).immediate();
      this.db.pragma('journal_mode = WAL');
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close(): void { this.db.close(); }
}
