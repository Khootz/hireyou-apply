import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

// Plain-SQL migrations applied in order, tracked in _migrations.
// Real tables arrive with their milestones (M1 profile, M3 jobs, ...).
const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: '001_app_meta',
    sql: `CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  },
  {
    id: '002_master_profile',
    sql: `CREATE TABLE IF NOT EXISTS master_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      contact_json TEXT NOT NULL,
      sections_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`,
  },
  {
    id: '003_jobs',
    sql: `CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      source_board TEXT NOT NULL DEFAULT 'manual',
      jd_text TEXT NOT NULL DEFAULT '',
      apply_email TEXT,
      deadline TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'saved',
      notes TEXT NOT NULL DEFAULT '',
      dedup_key TEXT NOT NULL UNIQUE,
      saved_at TEXT NOT NULL,
      applied_at TEXT,
      status_updated_at TEXT NOT NULL
    );`,
  },
  {
    id: '004_generation',
    sql: `CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content_json TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      pdf_path TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_documents_job ON documents (job_id, type, version);
    CREATE TABLE IF NOT EXISTS generation_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      document_id TEXT,
      created_at TEXT NOT NULL,
      finished_at TEXT
    );`,
  },
]

export interface Db {
  sqlite: Database.Database
  db: BetterSQLite3Database
}

export function migrate(sqlite: Database.Database): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`)
  const applied = new Set(
    (sqlite.prepare(`SELECT id FROM _migrations`).all() as { id: string }[]).map((r) => r.id),
  )
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue
    const tx = sqlite.transaction(() => {
      sqlite.exec(m.sql)
      sqlite.prepare(`INSERT INTO _migrations (id, applied_at) VALUES (?, ?)`).run(m.id, new Date().toISOString())
    })
    tx()
  }
}

export function openDb(dbPath = process.env.DATABASE_PATH ?? './apps/api/data/app.sqlite'): Db {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  }
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  migrate(sqlite)
  return { sqlite, db: drizzle(sqlite) }
}
