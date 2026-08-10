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
