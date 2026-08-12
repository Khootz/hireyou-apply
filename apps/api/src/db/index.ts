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
  {
    id: '006_autofill_cache_telemetry',
    sql: `CREATE TABLE IF NOT EXISTS autofill_form_cache (
      form_fingerprint TEXT PRIMARY KEY,
      classifications_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS field_suggestion_events (
      id TEXT PRIMARY KEY,
      form_fingerprint TEXT NOT NULL,
      canonical_field TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('copied','dismissed','ignored')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_suggestion_events_form ON field_suggestion_events (form_fingerprint);`,
  },
  {
    id: '007_application_answers',
    sql: `CREATE TABLE IF NOT EXISTS application_answers (
      canonical TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`,
  },
  {
    // Real option lists harvested from scanned forms, one per answerable
    // canonical — the answers page renders these as dropdowns so saved
    // answers match the form's exact wording. Latest scan wins.
    id: '008_answer_option_vocab',
    sql: `CREATE TABLE IF NOT EXISTS answer_option_vocab (
      canonical TEXT PRIMARY KEY,
      options_json TEXT NOT NULL,
      source_host TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );`,
  },
  {
    // Pre-generated documents for demo jobs: the runner serves these instead
    // of calling the LLM, so a stage demo is fast and deterministic. Seed via
    // scripts/seed-demo-cache.ts after generating once for real.
    id: '009_demo_generation_cache',
    sql: `CREATE TABLE IF NOT EXISTS demo_generation_cache (
      job_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      content_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (job_id, kind)
    );`,
  },
  {
    id: '005_email_records',
    sql: `CREATE TABLE IF NOT EXISTS email_records (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      to_intended TEXT NOT NULL,
      to_actual TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      attachment_doc_ids TEXT NOT NULL,
      safe_mode INTEGER NOT NULL,
      sent_at TEXT NOT NULL
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
