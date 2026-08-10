import crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  DocumentContentSchema,
  type DocumentContent,
  type DocumentRecord,
  type DocumentType,
  type RunKind,
  type RunRecord,
} from '@app/shared'
import { generateCoverLetter, generateTailoredResume } from './generation'
import { getJob } from './jobs'
import { getProfile } from './profile'

export function getRun(sqlite: Database.Database, id: string): RunRecord | null {
  const row = sqlite.prepare(`SELECT * FROM generation_runs WHERE id = ?`).get(id) as RunRecord | undefined
  return row ?? null
}

export function findActiveRun(sqlite: Database.Database, jobId: string, kind: RunKind): RunRecord | null {
  const row = sqlite
    .prepare(`SELECT * FROM generation_runs WHERE job_id = ? AND kind = ? AND status IN ('queued','running') ORDER BY created_at DESC`)
    .get(jobId, kind) as RunRecord | undefined
  return row ?? null
}

export function createRun(sqlite: Database.Database, jobId: string, kind: RunKind): RunRecord {
  const id = crypto.randomUUID()
  sqlite
    .prepare(`INSERT INTO generation_runs (id, job_id, kind, status, created_at) VALUES (?, ?, ?, 'queued', ?)`)
    .run(id, jobId, kind, new Date().toISOString())
  return getRun(sqlite, id)!
}

export function insertDocument(
  sqlite: Database.Database,
  jobId: string,
  type: DocumentType,
  content: DocumentContent,
): DocumentRecord {
  const id = crypto.randomUUID()
  const version =
    ((sqlite.prepare(`SELECT MAX(version) AS v FROM documents WHERE job_id = ? AND type = ?`).get(jobId, type) as { v: number | null }).v ?? 0) + 1
  sqlite
    .prepare(`INSERT INTO documents (id, job_id, type, content_json, version, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, jobId, type, JSON.stringify(content), version, new Date().toISOString())
  return getDocument(sqlite, id)!
}

export function getDocument(sqlite: Database.Database, id: string): DocumentRecord | null {
  const row = sqlite.prepare(`SELECT * FROM documents WHERE id = ?`).get(id) as
    | { id: string; job_id: string; type: DocumentType; content_json: string; version: number; created_at: string }
    | undefined
  if (!row) return null
  return {
    id: row.id,
    job_id: row.job_id,
    type: row.type,
    version: row.version,
    created_at: row.created_at,
    content: DocumentContentSchema.parse(JSON.parse(row.content_json)),
  }
}

export function listDocuments(sqlite: Database.Database, jobId: string): Omit<DocumentRecord, 'content'>[] {
  const rows = sqlite
    .prepare(`SELECT id, job_id, type, version, created_at FROM documents WHERE job_id = ? ORDER BY type, version DESC`)
    .all(jobId) as Omit<DocumentRecord, 'content'>[]
  return rows
}

// In-process async runner. Generation takes ~10-30s, far too long for a
// synchronous request; the route returns a queued run and the client polls.
// drain() lets tests await deterministic completion.
export class Runner {
  private pending: Promise<void>[] = []

  constructor(private sqlite: Database.Database) {}

  enqueue(runId: string): void {
    this.pending.push(this.process(runId))
  }

  async drain(): Promise<void> {
    while (this.pending.length > 0) {
      const batch = this.pending
      this.pending = []
      await Promise.allSettled(batch)
    }
  }

  private async process(runId: string): Promise<void> {
    const { sqlite } = this
    const run = getRun(sqlite, runId)
    if (!run || run.status !== 'queued') return
    sqlite.prepare(`UPDATE generation_runs SET status = 'running' WHERE id = ?`).run(runId)
    try {
      const job = getJob(sqlite, run.job_id)
      if (!job) throw new Error('job disappeared')
      const profile = getProfile(sqlite)
      const content =
        run.kind === 'tailor_resume' ? await generateTailoredResume(profile, job) : await generateCoverLetter(profile, job)
      const doc = insertDocument(sqlite, job.id, run.kind === 'tailor_resume' ? 'resume' : 'cover_letter', content)
      sqlite
        .prepare(`UPDATE generation_runs SET status = 'succeeded', document_id = ?, finished_at = ? WHERE id = ?`)
        .run(doc.id, new Date().toISOString(), runId)
    } catch (err) {
      sqlite
        .prepare(`UPDATE generation_runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`)
        .run((err as Error).message, new Date().toISOString(), runId)
    }
  }
}
