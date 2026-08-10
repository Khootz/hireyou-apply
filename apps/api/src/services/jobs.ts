import crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import type { JobInput, JobPatch, JobRecord } from '@app/shared'

// Dedup: the same posting saved from two different URLs (listing page vs
// direct link) must land on one row, so the key ignores the URL entirely.
export function dedupKey(job: Pick<JobInput, 'source_board' | 'company' | 'title'>): string {
  return [job.source_board, job.company.trim().toLowerCase(), job.title.trim().toLowerCase()].join('|')
}

interface JobRow {
  id: string
  title: string
  company: string
  location: string
  source_url: string
  source_board: string
  jd_text: string
  apply_email: string | null
  deadline: string
  status: string
  notes: string
  saved_at: string
  applied_at: string | null
  status_updated_at: string
}

function toRecord(row: JobRow): JobRecord {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    location: row.location,
    source_url: row.source_url,
    source_board: row.source_board as JobRecord['source_board'],
    jd_text: row.jd_text,
    apply_email: row.apply_email,
    deadline: row.deadline,
    status: row.status as JobRecord['status'],
    notes: row.notes,
    saved_at: row.saved_at,
    applied_at: row.applied_at,
    status_updated_at: row.status_updated_at,
  }
}

export function createJob(sqlite: Database.Database, input: JobInput): { job: JobRecord; deduped: boolean } {
  const key = dedupKey(input)
  const existing = sqlite.prepare(`SELECT * FROM jobs WHERE dedup_key = ?`).get(key) as JobRow | undefined
  if (existing) {
    return { job: toRecord(existing), deduped: true }
  }
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  sqlite
    .prepare(
      `INSERT INTO jobs (id, title, company, location, source_url, source_board, jd_text, apply_email, deadline, status, notes, dedup_key, saved_at, applied_at, status_updated_at)
       VALUES (@id, @title, @company, @location, @source_url, @source_board, @jd_text, @apply_email, @deadline, @status, @notes, @dedup_key, @saved_at, @applied_at, @status_updated_at)`,
    )
    .run({
      id,
      title: input.title,
      company: input.company,
      location: input.location,
      source_url: input.source_url,
      source_board: input.source_board,
      jd_text: input.jd_text,
      apply_email: input.apply_email,
      deadline: input.deadline,
      status: input.status,
      notes: input.notes,
      dedup_key: key,
      saved_at: now,
      applied_at: input.status === 'applied' ? now : null,
      status_updated_at: now,
    })
  return { job: getJob(sqlite, id)!, deduped: false }
}

export function listJobs(sqlite: Database.Database): JobRecord[] {
  const rows = sqlite
    .prepare(
      `SELECT jobs.*, (SELECT GROUP_CONCAT(DISTINCT type) FROM documents WHERE documents.job_id = jobs.id) AS mats
       FROM jobs ORDER BY status_updated_at DESC, saved_at DESC`,
    )
    .all() as (JobRow & { mats: string | null })[]
  return rows.map((row) => ({
    ...toRecord(row),
    materials: (row.mats ?? '').split(',').filter(Boolean) as JobRecord['materials'],
  }))
}

export function getJob(sqlite: Database.Database, id: string): JobRecord | null {
  const row = sqlite.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as JobRow | undefined
  return row ? toRecord(row) : null
}

export function patchJob(sqlite: Database.Database, id: string, patch: JobPatch): JobRecord | null {
  const current = getJob(sqlite, id)
  if (!current) return null

  const next: JobRecord = { ...current, ...patch }
  const now = new Date().toISOString()
  const statusChanged = patch.status !== undefined && patch.status !== current.status
  const statusUpdatedAt = statusChanged ? now : current.status_updated_at
  const appliedAt =
    statusChanged && patch.status === 'applied' && !current.applied_at ? now : current.applied_at

  sqlite
    .prepare(
      `UPDATE jobs SET title=@title, company=@company, location=@location, source_url=@source_url,
        source_board=@source_board, jd_text=@jd_text, apply_email=@apply_email, deadline=@deadline,
        status=@status, notes=@notes, dedup_key=@dedup_key, applied_at=@applied_at, status_updated_at=@status_updated_at
       WHERE id=@id`,
    )
    .run({
      id,
      title: next.title,
      company: next.company,
      location: next.location,
      source_url: next.source_url,
      source_board: next.source_board,
      jd_text: next.jd_text,
      apply_email: next.apply_email,
      deadline: next.deadline,
      status: next.status,
      notes: next.notes,
      dedup_key: dedupKey(next),
      applied_at: appliedAt,
      status_updated_at: statusUpdatedAt,
    })
  return getJob(sqlite, id)
}

export function deleteJob(sqlite: Database.Database, id: string): boolean {
  return sqlite.prepare(`DELETE FROM jobs WHERE id = ?`).run(id).changes > 0
}
