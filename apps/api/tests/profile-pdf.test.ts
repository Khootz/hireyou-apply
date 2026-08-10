import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { MasterProfileSchema, type JobRecord, type RunRecord } from '@app/shared'
import { openDb } from '../src/db'
import { buildServer } from '../src/server'
import { extractPdfText } from '../src/services/cvExtract'
import { closePdfBrowser } from '../src/services/pdf'

const AUTH = { authorization: 'Bearer test-token' }
const GEN = path.resolve(process.cwd(), 'tests/fixtures/generation')

let app: FastifyInstance

beforeAll(() => {
  process.env.API_AUTH_TOKEN = 'test-token'
  process.env.PDF_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hireyou-profilepdf-'))
})

beforeEach(() => {
  app = buildServer({ sqlite: openDb(':memory:').sqlite })
})

afterAll(async () => {
  await closePdfBrowser()
})

describe('master profile live preview PDF', () => {
  it('renders the saved profile with selectable text and reports page count', async () => {
    const profile = MasterProfileSchema.parse(JSON.parse(fs.readFileSync(path.join(GEN, 'profile.json'), 'utf8')))
    await app.inject({ method: 'PUT', url: '/api/profile', headers: AUTH, payload: profile })

    const noAuth = await app.inject({ method: 'GET', url: '/api/profile/pdf' })
    expect(noAuth.statusCode).toBe(401)

    const res = await app.inject({ method: 'GET', url: '/api/profile/pdf?token=test-token' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(res.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-')

    const text = await extractPdfText(new Uint8Array(res.rawPayload))
    expect(text.text).toContain('KHOO')
    expect(text.text.toUpperCase()).toContain('WORK EXPERIENCE')

    const meta = await app.inject({ method: 'GET', url: '/api/profile/pdf/meta', headers: AUTH })
    expect((meta.json() as { pages: number }).pages).toBeGreaterThanOrEqual(1)
  }, 60_000)

  it('renders an empty profile without crashing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/profile/pdf?token=test-token' })
    expect(res.statusCode).toBe(200)
    expect(res.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  }, 60_000)
})

describe('jobs list materials', () => {
  it('reports which document types exist per job', async () => {
    const profile = MasterProfileSchema.parse(JSON.parse(fs.readFileSync(path.join(GEN, 'profile.json'), 'utf8')))
    await app.inject({ method: 'PUT', url: '/api/profile', headers: AUTH, payload: profile })
    const created = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: AUTH,
      payload: {
        title: 'Quant Researcher Intern',
        company: 'Jain Global',
        source_board: 'hkust',
        jd_text: fs.readFileSync(path.join(GEN, 'jain-jd.txt'), 'utf8'),
      },
    })
    const jobId = (created.json() as { job: JobRecord }).job.id

    const before = await app.inject({ method: 'GET', url: '/api/jobs', headers: AUTH })
    expect((before.json() as { jobs: JobRecord[] }).jobs[0].materials).toEqual([])

    const gen = await app.inject({ method: 'POST', url: `/api/jobs/${jobId}/generate`, headers: AUTH, payload: { type: 'resume' } })
    expect([200, 202]).toContain(gen.statusCode)
    void (gen.json() as { run: RunRecord })
    await app.runner.drain()

    const after = await app.inject({ method: 'GET', url: '/api/jobs', headers: AUTH })
    expect((after.json() as { jobs: JobRecord[] }).jobs[0].materials).toEqual(['resume'])
  })
})
