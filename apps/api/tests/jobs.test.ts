import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { JobRecord } from '@app/shared'
import { openDb } from '../src/db'
import { buildServer } from '../src/server'

const AUTH = { authorization: 'Bearer test-token' }

let app: FastifyInstance

beforeAll(() => {
  process.env.API_AUTH_TOKEN = 'test-token'
})

beforeEach(() => {
  app = buildServer({ sqlite: openDb(':memory:').sqlite })
})

const jainGlobal = {
  title: 'Quant Researcher Intern',
  company: 'Jain Global',
  location: 'Hong Kong',
  source_url: 'https://career.hkust.edu.hk/web/job_detail.php?jp=86585',
  source_board: 'hkust' as const,
  jd_text: 'Quantitative research internship focused on systematic strategies.',
  apply_email: 'APAC-Careers@jainglobal.com',
}

describe('jobs API', () => {
  it('creates a job with defaults and lists it', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/jobs', headers: AUTH, payload: jainGlobal })
    expect(created.statusCode).toBe(201)
    const { job, deduped } = created.json() as { job: JobRecord; deduped: boolean }
    expect(deduped).toBe(false)
    expect(job.status).toBe('saved')
    expect(job.applied_at).toBeNull()
    expect(job.saved_at).toBeTruthy()

    const list = await app.inject({ method: 'GET', url: '/api/jobs', headers: AUTH })
    expect((list.json() as { jobs: JobRecord[] }).jobs).toHaveLength(1)
  })

  it('dedups the same posting saved from two different URLs', async () => {
    const first = await app.inject({ method: 'POST', url: '/api/jobs', headers: AUTH, payload: jainGlobal })
    const second = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: AUTH,
      payload: { ...jainGlobal, source_url: 'https://career.hkust.edu.hk/web/job.php?page=2' },
    })
    expect(second.statusCode).toBe(200)
    const { job, deduped } = second.json() as { job: JobRecord; deduped: boolean }
    expect(deduped).toBe(true)
    expect(job.id).toBe((first.json() as { job: JobRecord }).job.id)

    const list = await app.inject({ method: 'GET', url: '/api/jobs', headers: AUTH })
    expect((list.json() as { jobs: JobRecord[] }).jobs).toHaveLength(1)
  })

  it('case/whitespace differences still dedup', async () => {
    await app.inject({ method: 'POST', url: '/api/jobs', headers: AUTH, payload: jainGlobal })
    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: AUTH,
      payload: { ...jainGlobal, company: '  JAIN GLOBAL ', title: 'quant researcher intern' },
    })
    expect((res.json() as { deduped: boolean }).deduped).toBe(true)
  })

  it('stamps applied_at on first transition to applied and keeps it thereafter', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/jobs', headers: AUTH, payload: jainGlobal })
    const id = (created.json() as { job: JobRecord }).job.id

    const applied = await app.inject({ method: 'PATCH', url: `/api/jobs/${id}`, headers: AUTH, payload: { status: 'applied' } })
    const appliedAt = (applied.json() as JobRecord).applied_at
    expect(appliedAt).toBeTruthy()

    const interviewing = await app.inject({ method: 'PATCH', url: `/api/jobs/${id}`, headers: AUTH, payload: { status: 'interviewing' } })
    expect((interviewing.json() as JobRecord).applied_at).toBe(appliedAt)

    const backToApplied = await app.inject({ method: 'PATCH', url: `/api/jobs/${id}`, headers: AUTH, payload: { status: 'applied' } })
    expect((backToApplied.json() as JobRecord).applied_at).toBe(appliedAt)
  })

  it('updates notes without touching status_updated_at', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/jobs', headers: AUTH, payload: jainGlobal })
    const job = (created.json() as { job: JobRecord }).job

    const patched = await app.inject({ method: 'PATCH', url: `/api/jobs/${job.id}`, headers: AUTH, payload: { notes: 'referred by a friend' } })
    const after = patched.json() as JobRecord
    expect(after.notes).toBe('referred by a friend')
    expect(after.status_updated_at).toBe(job.status_updated_at)
  })

  it('rejects jd_text over 4000 chars', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: AUTH,
      payload: { ...jainGlobal, jd_text: 'x'.repeat(4001) },
    })
    expect(res.statusCode).toBe(400)
  })

  it('deletes a job and 404s afterwards', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/jobs', headers: AUTH, payload: jainGlobal })
    const id = (created.json() as { job: JobRecord }).job.id
    const del = await app.inject({ method: 'DELETE', url: `/api/jobs/${id}`, headers: AUTH })
    expect(del.statusCode).toBe(200)
    const get = await app.inject({ method: 'GET', url: `/api/jobs/${id}`, headers: AUTH })
    expect(get.statusCode).toBe(404)
  })
})
