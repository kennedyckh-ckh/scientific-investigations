import path from "node:path";
import fs from "node:fs";

/* node:sqlite is loaded through process.getBuiltinModule so the bundler never tries to resolve it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sqlite = (process as any).getBuiltinModule("node:sqlite") as {
  DatabaseSync: new (p: string) => DB;
};

interface Stmt {
  all(...p: unknown[]): Record<string, unknown>[];
  get(...p: unknown[]): Record<string, unknown> | undefined;
  run(...p: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}
interface DB {
  exec(sql: string): void;
  prepare(sql: string): Stmt;
}

export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK(role IN ('teacher','educator')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_tokens(
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('staff','student')),
  user_id INTEGER,
  student_id INTEGER,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS educator_teacher(
  educator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(educator_id, teacher_id)
);
CREATE TABLE IF NOT EXISTS templates(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  educator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  pedagogy_notes TEXT NOT NULL DEFAULT '',
  ai_criteria TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS template_parts(
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  part INTEGER NOT NULL CHECK(part IN (1,2,3)),
  instructions TEXT NOT NULL DEFAULT '',
  web_link TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(template_id, part)
);
CREATE TABLE IF NOT EXISTS template_questions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  part INTEGER NOT NULL,
  position INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS template_assignments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT '',
  ref_links_json TEXT NOT NULL DEFAULT '[]',
  assigned_at INTEGER NOT NULL,
  UNIQUE(template_id, teacher_id)
);
CREATE TABLE IF NOT EXISTS sessions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  join_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  source_template_id INTEGER,
  source_version INTEGER,
  pedagogy_notes TEXT NOT NULL DEFAULT '',
  anonymise_sharing INTEGER NOT NULL DEFAULT 0,
  critique_prompts_json TEXT NOT NULL,
  ai_criteria TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  archived_at INTEGER
);
CREATE TABLE IF NOT EXISTS session_parts(
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  part INTEGER NOT NULL CHECK(part IN (1,2,3)),
  instructions TEXT NOT NULL DEFAULT '',
  web_link TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'visible' CHECK(visibility IN ('hidden','visible','open')),
  PRIMARY KEY(session_id, part)
);
CREATE TABLE IF NOT EXISTS session_questions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  part INTEGER NOT NULL,
  position INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS groups(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  pin TEXT,
  seat_cap INTEGER
);
CREATE TABLE IF NOT EXISTS students(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  class TEXT NOT NULL,
  class_no TEXT NOT NULL,
  name_key TEXT NOT NULL,
  last_seen INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(session_id, name_key)
);
CREATE TABLE IF NOT EXISTS recovery_requests(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  approved_at INTEGER,
  consumed_at INTEGER
);
CREATE TABLE IF NOT EXISTS entries(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  part INTEGER NOT NULL,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  tag TEXT,
  body TEXT NOT NULL DEFAULT '',
  image_file TEXT,
  table_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_entries_group ON entries(group_id, part);
CREATE TABLE IF NOT EXISTS presence(
  student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL,
  part INTEGER,
  editing_entry_id INTEGER,
  last_beat INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS part_submissions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  part INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  submitted_by INTEGER NOT NULL,
  submitted_at INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  unlocked_at INTEGER,
  unlocked_by INTEGER,
  UNIQUE(group_id, part, revision)
);
CREATE TABLE IF NOT EXISTS part_overrides(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  part INTEGER NOT NULL,
  overridden_by INTEGER NOT NULL,
  reason TEXT NOT NULL,
  missing_groups_json TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shares(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  published_at INTEGER NOT NULL,
  UNIQUE(session_id, entry_id)
);
CREATE TABLE IF NOT EXISTS critiques(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  share_id INTEGER NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  prompt_key TEXT NOT NULL,
  body TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_outputs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('group_summary','cross_group','discussion_points')),
  group_id INTEGER,
  part INTEGER NOT NULL,
  criteria TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL,
  content_json TEXT NOT NULL,
  cited_ids_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','edited','published','revealed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER
);
CREATE TABLE IF NOT EXISTS audit_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT NOT NULL,
  actor_id INTEGER,
  action TEXT NOT NULL,
  target TEXT,
  at INTEGER NOT NULL
);
`;

type G = typeof globalThis & { __db?: DB };

function open(): DB {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const db = new sqlite.DatabaseSync(path.join(DATA_DIR, process.env.DB_FILE || "app.db"));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  db.exec(SCHEMA);
  return db;
}

export function db(): DB {
  const g = globalThis as G;
  if (!g.__db) {
    g.__db = open();
    // lazy import avoids a circular dependency at module load
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("./seed").seedIfEmpty();
  }
  return g.__db;
}

export type Row = Record<string, unknown>;
export const all = (sql: string, ...p: unknown[]): Row[] => db().prepare(sql).all(...p);
export const get = (sql: string, ...p: unknown[]): Row | undefined => db().prepare(sql).get(...p);
export function run(sql: string, ...p: unknown[]): { changes: number; id: number } {
  const r = db().prepare(sql).run(...p);
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
}
export function tx<T>(fn: () => T): T {
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    d.exec("COMMIT");
    return r;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}
export const now = () => Date.now();
export const num = (v: unknown) => Number(v);
export function audit(actorType: string, actorId: number | null, action: string, target?: string) {
  run("INSERT INTO audit_log(actor_type,actor_id,action,target,at) VALUES(?,?,?,?,?)", actorType, actorId, action, target ?? null, now());
}
