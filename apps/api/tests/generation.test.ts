import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import {
  MasterProfileSchema,
  type CoverLetterDocument,
  type DocumentRecord,
  type JobRecord,
  type MasterProfile,
  type ResumeDocument,
  type RunRecord,
} from '@app/shared'
import type Database from 'better-sqlite3'
import { openDb } from '../src/db'
import { buildServer } from '../src/server'
import { GenerationValidationError, generateTailoredResume } from '../src/services/generation'
import { createRun } from '../src/services/runs'

const AUTH = { authorization: 'Bearer test-token' }
const GEN = path.resolve(process.cwd(), 'tests/fixtures/generation')

const testProfile = () =>
  MasterProfileSchema.parse(JSON.parse(fs.readFileSync(path.join(GEN, 'profile.json'), 'utf8')))
const jainJd = () => fs.readFileSync(path.join(GEN, 'jain-jd.txt'), 'utf8')

let app: FastifyInstance
let sqlite: Database.Database

beforeAll(() => {
  process.env.API_AUTH_TOKEN = 'test-token'
})

beforeEach(() => {
  sqlite = openDb(':memory:').sqlite
  app = buildServer({ sqlite })
})

async function seedProfileAndJob(): Promise<string> {
  const put = await app.inject({ method: 'PUT', url: '/api/profile', headers: AUTH, payload: testProfile() })
  expect(put.statusCode).toBe(200)
  const created = await app.inject({
    method: 'POST',
    url: '/api/jobs',
    headers: AUTH,
    payload: {
      title: 'Quant Researcher Intern',
      company: 'Jain Global',
      source_board: 'hkust',
      source_url: 'https://career.hkust.edu.hk/web/job_detail.php?jp=86585',
      jd_text: jainJd(),
      apply_email: 'APAC-Careers@jainglobal.com',
    },
  })
  expect(created.statusCode).toBe(201)
  return (created.json() as { job: JobRecord }).job.id
}

function allProfileFactIds(profile: MasterProfile): Set<string> {
  const ids = new Set<string>()
  for (const s of profile.sections) {
    if (s.type === 'experience')
      for (const e of s.content.entries) {
        ids.add(e.fact_id)
        for (const b of e.bullets) ids.add(b.fact_id)
      }
    if (s.type === 'bullets') for (const b of s.content.items) ids.add(b.fact_id)
  }
  return ids
}

async function generate(jobId: string, type: 'resume' | 'cover_letter'): Promise<RunRecord> {
  const res = await app.inject({ method: 'POST', url: `/api/jobs/${jobId}/generate`, headers: AUTH, payload: { type } })
  expect([200, 202]).toContain(res.statusCode)
  const runId = (res.json() as { run: RunRecord }).run.id
  await app.runner.drain()
  const run = await app.inject({ method: 'GET', url: `/api/runs/${runId}`, headers: AUTH })
  return run.json() as RunRecord
}

describe('generation engine (LLM replayed from recorded fixtures)', () => {
  it('tailors a resume where every bullet resolves to a profile fact', async () => {
    const jobId = await seedProfileAndJob()
    const run = await generate(jobId, 'resume')
    expect(run.status).toBe('succeeded')
    expect(run.document_id).toBeTruthy()

    const doc = await app.inject({ method: 'GET', url: `/api/documents/${run.document_id}`, headers: AUTH })
    const record = doc.json() as DocumentRecord
    expect(record.version).toBe(1)
    const content = record.content as ResumeDocument
    expect(content.kind).toBe('resume')

    const profile = testProfile()
    const validIds = allProfileFactIds(profile)
    const profileOrgs = new Set(
      profile.sections.flatMap((s) => (s.type === 'experience' ? s.content.entries.map((e) => e.organisation) : [])),
    )

    let bulletCount = 0
    for (const section of content.sections) {
      if (section.type === 'experience') {
        for (const entry of section.entries) {
          expect(validIds.has(entry.source_fact_id), `entry ${entry.organisation}`).toBe(true)
          expect(profileOrgs.has(entry.organisation), `org ${entry.organisation} must exist in profile`).toBe(true)
          for (const b of entry.bullets) {
            expect(validIds.has(b.source_fact_id), `bullet ${b.text.slice(0, 40)}`).toBe(true)
            bulletCount++
          }
        }
      }
      if (section.type === 'bullets') {
        for (const b of section.items) {
          expect(validIds.has(b.source_fact_id)).toBe(true)
          bulletCount++
        }
      }
    }
    expect(bulletCount).toBeGreaterThan(5)
  })

  it('regeneration creates version 2 and keeps version 1', async () => {
    const jobId = await seedProfileAndJob()
    const first = await generate(jobId, 'resume')
    const second = await generate(jobId, 'resume')
    expect(second.status).toBe('succeeded')
    expect(second.document_id).not.toBe(first.document_id)

    const list = await app.inject({ method: 'GET', url: `/api/jobs/${jobId}/documents`, headers: AUTH })
    const docs = (list.json() as { documents: Omit<DocumentRecord, 'content'>[] }).documents.filter((d) => d.type === 'resume')
    expect(docs.map((d) => d.version).sort()).toEqual([1, 2])
  })

  it('a generate request while a run is already active returns that run (idempotency)', async () => {
    const jobId = await seedProfileAndJob()
    const active = createRun(sqlite, jobId, 'tailor_resume')
    const res = await app.inject({ method: 'POST', url: `/api/jobs/${jobId}/generate`, headers: AUTH, payload: { type: 'resume' } })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { run: RunRecord }).run.id).toBe(active.id)
    expect((res.json() as { deduped: boolean }).deduped).toBe(true)
  })

  it('generates a cover letter naming the company and exact role in paragraph 1', async () => {
    const jobId = await seedProfileAndJob()
    const run = await generate(jobId, 'cover_letter')
    expect(run.status).toBe('succeeded')

    const doc = await app.inject({ method: 'GET', url: `/api/documents/${run.document_id}`, headers: AUTH })
    const content = (doc.json() as DocumentRecord).content as CoverLetterDocument
    expect(content.kind).toBe('cover_letter')
    expect(content.paragraphs).toHaveLength(3)
    expect(content.paragraphs[0].toLowerCase()).toContain('jain global')
    expect(content.paragraphs[0].toLowerCase()).toContain('quant researcher intern')
    expect(content.contact.email).toBe('tzkhoo@connect.ust.hk')
  })

  it('refuses to generate when profile or JD is not ready', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: AUTH,
      payload: { title: 'X', company: 'Y' },
    })
    const jobId = (created.json() as { job: JobRecord }).job.id
    const res = await app.inject({ method: 'POST', url: `/api/jobs/${jobId}/generate`, headers: AUTH, payload: { type: 'resume' } })
    expect(res.statusCode).toBe(422)
    expect((res.json() as { problems: string[] }).problems.length).toBeGreaterThan(0)
  })

  it('the provenance gate rejects a plan referencing facts that do not exist', async () => {
    const profile = testProfile()
    const job = {
      id: 'j',
      title: 'Quant Researcher Intern',
      company: 'Jain Global',
      location: '',
      source_url: '',
      source_board: 'hkust',
      jd_text: jainJd(),
      apply_email: null,
      deadline: '',
      status: 'saved',
      notes: '',
      saved_at: '',
      applied_at: null,
      status_updated_at: '',
    } as JobRecord
    await expect(generateTailoredResume(profile, job, 'tailor-bogus')).rejects.toThrow(GenerationValidationError)
  })

  it('a demo-cached job replays the cached document instead of calling the LLM', async () => {
    process.env.DEMO_GEN_DELAY_MS = '0'
    try {
      const jobId = await seedProfileAndJob()
      // Sentinel content the recorded LLM fixtures could never produce.
      const cached = {
        kind: 'cover_letter',
        contact: { full_name: 'Demo Cache', email: 'demo@cache.hk', phone: '', location: '' },
        company: 'Jain Global',
        role: 'Quant Researcher Intern',
        date: '2026-01-01',
        salutation: 'Dear Hiring Team,',
        paragraphs: ['cached paragraph one', 'cached paragraph two', 'cached paragraph three'],
        signoff: 'Yours faithfully,',
      }
      sqlite
        .prepare(`INSERT INTO demo_generation_cache (job_id, kind, content_json, created_at) VALUES (?, ?, ?, ?)`)
        .run(jobId, 'cover_letter', JSON.stringify(cached), new Date().toISOString())

      const run = await generate(jobId, 'cover_letter')
      expect(run.status).toBe('succeeded')
      const doc = await app.inject({ method: 'GET', url: `/api/documents/${run.document_id}`, headers: AUTH })
      const content = (doc.json() as DocumentRecord).content as CoverLetterDocument
      expect(content.paragraphs[0]).toBe('cached paragraph one')
      expect(content.contact.full_name).toBe('Demo Cache')
    } finally {
      delete process.env.DEMO_GEN_DELAY_MS
    }
  })

  it('a failed run records the error and produces no document', async () => {
    // No profile seeded: the recorded plan's aliases resolve to nothing.
    const created = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: AUTH,
      payload: { title: 'Quant Researcher Intern', company: 'Jain Global', jd_text: jainJd(), source_board: 'hkust' },
    })
    const jobId = (created.json() as { job: JobRecord }).job.id
    // a minimal valid profile passes the readiness gate, but the recorded
    // plan's aliases point at sections this profile doesn't have
    const seeded = await app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: AUTH,
      payload: {
        contact: { full_name: 'X', email: 'x@y.hk', phone: '', location: '' },
        sections: [
          {
            id: 'only', order: 0, type: 'experience', title: 'EXPERIENCE',
            content: { entries: [{ fact_id: 'lone-entry', organisation: 'Org', role: 'R', start_date: '', end_date: '', is_current: false, location: '', bullets: [{ fact_id: 'lone-bullet', text: 'did a thing' }] }] },
          },
        ],
      },
    })
    expect(seeded.statusCode).toBe(200)

    const res = await app.inject({ method: 'POST', url: `/api/jobs/${jobId}/generate`, headers: AUTH, payload: { type: 'resume' } })
    const runId = (res.json() as { run: RunRecord }).run.id
    await app.runner.drain()
    const run = (await app.inject({ method: 'GET', url: `/api/runs/${runId}`, headers: AUTH })).json() as RunRecord
    expect(run.status).toBe('failed')
    expect(run.error).toBeTruthy()
    expect(run.document_id).toBeNull()

    const list = await app.inject({ method: 'GET', url: `/api/jobs/${jobId}/documents`, headers: AUTH })
    expect((list.json() as { documents: unknown[] }).documents).toHaveLength(0)
  })
})
