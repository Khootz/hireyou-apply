import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { MasterProfileSchema, type JobRecord, type RunRecord } from '@app/shared'
import { openDb } from '../src/db'
import { buildServer } from '../src/server'
import { extractPdfText } from '../src/services/cvExtract'
import { generateCoverLetter, generateTailoredResume } from '../src/services/generation'
import { closePdfBrowser, renderDocumentPdf } from '../src/services/pdf'

const AUTH = { authorization: 'Bearer test-token' }
const GEN = path.resolve(process.cwd(), 'tests/fixtures/generation')

const testProfile = () =>
  MasterProfileSchema.parse(JSON.parse(fs.readFileSync(path.join(GEN, 'profile.json'), 'utf8')))

const testJob = (): JobRecord => ({
  id: 'j',
  title: 'Quant Researcher Intern',
  company: 'Jain Global',
  location: 'Hong Kong',
  source_url: '',
  source_board: 'hkust',
  jd_text: fs.readFileSync(path.join(GEN, 'jain-jd.txt'), 'utf8'),
  apply_email: null,
  deadline: '',
  status: 'saved',
  notes: '',
  saved_at: '',
  applied_at: null,
  status_updated_at: '',
})

let app: FastifyInstance

beforeAll(() => {
  process.env.API_AUTH_TOKEN = 'test-token'
  process.env.PDF_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hireyou-pdf-'))
})

beforeEach(() => {
  app = buildServer({ sqlite: openDb(':memory:').sqlite })
})

afterAll(async () => {
  await closePdfBrowser()
})

describe('PDF renderer (drives system Chrome)', () => {
  it('renders the tailored resume with selectable text and stable page count', async () => {
    const content = await generateTailoredResume(testProfile(), testJob())
    const first = await renderDocumentPdf(content)
    expect(first.subarray(0, 5).toString('latin1')).toBe('%PDF-')

    const extractedFirst = await extractPdfText(new Uint8Array(first))
    expect(extractedFirst.text).toContain('KHOO')
    expect(extractedFirst.text.toUpperCase()).toContain('WORK EXPERIENCE')
    expect(extractedFirst.text).toContain('Wonder')

    const second = await renderDocumentPdf(content)
    const extractedSecond = await extractPdfText(new Uint8Array(second))
    expect(extractedSecond.pages).toBe(extractedFirst.pages)
    expect(extractedSecond.text).toBe(extractedFirst.text)
  }, 60_000)

  it('renders the cover letter naming company and role', async () => {
    const content = await generateCoverLetter(testProfile(), testJob())
    const pdf = await renderDocumentPdf(content)
    const extracted = await extractPdfText(new Uint8Array(pdf))
    expect(extracted.text).toContain('Jain Global')
    expect(extracted.text).toContain('Quant Researcher Intern')
    expect(extracted.text).toContain('Dear Hiring Manager')
    expect(extracted.pages).toBeGreaterThanOrEqual(1)
  }, 60_000)

  it('serves the PDF over the API with query-token auth (iframe path)', async () => {
    await app.inject({ method: 'PUT', url: '/api/profile', headers: AUTH, payload: testProfile() })
    const created = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: AUTH,
      payload: { title: 'Quant Researcher Intern', company: 'Jain Global', source_board: 'hkust', jd_text: testJob().jd_text },
    })
    const jobId = (created.json() as { job: JobRecord }).job.id
    const gen = await app.inject({ method: 'POST', url: `/api/jobs/${jobId}/generate`, headers: AUTH, payload: { type: 'resume' } })
    const runId = (gen.json() as { run: RunRecord }).run.id
    await app.runner.drain()
    const run = (await app.inject({ method: 'GET', url: `/api/runs/${runId}`, headers: AUTH })).json() as RunRecord
    expect(run.status).toBe('succeeded')

    const noAuth = await app.inject({ method: 'GET', url: `/api/documents/${run.document_id}/pdf` })
    expect(noAuth.statusCode).toBe(401)

    const res = await app.inject({ method: 'GET', url: `/api/documents/${run.document_id}/pdf?token=test-token` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(res.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-')

    // second fetch serves the cached file
    const again = await app.inject({ method: 'GET', url: `/api/documents/${run.document_id}/pdf?token=test-token` })
    expect(again.rawPayload.length).toBe(res.rawPayload.length)
  }, 60_000)
})
