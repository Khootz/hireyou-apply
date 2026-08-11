import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { MasterProfileSchema, type JobRecord, type RunRecord } from '@app/shared'
import { openDb } from '../src/db'
import { buildServer } from '../src/server'
import { resolveRecipient, type EmailDraft, type EmailRecordRow, type MailTransport } from '../src/services/mailer'
import { closePdfBrowser } from '../src/services/pdf'

const AUTH = { authorization: 'Bearer test-token' }
const GEN = path.resolve(process.cwd(), 'tests/fixtures/generation')

let app: FastifyInstance
let sentMail: Parameters<MailTransport['sendMail']>[0][]

beforeAll(() => {
  process.env.API_AUTH_TOKEN = 'test-token'
  process.env.SAFE_MODE = 'true'
  process.env.SAFE_MODE_RECIPIENT = 'tzkhoo@connect.ust.hk'
  process.env.PDF_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hireyou-mail-'))
})

// Chrome shutdown can exceed the 10s default hook timeout under parallel load
afterAll(async () => {
  await closePdfBrowser()
}, 30_000)

beforeEach(() => {
  sentMail = []
  const fakeTransport: MailTransport = {
    sendMail: async (opts) => {
      sentMail.push(opts)
      return { accepted: [opts.to] }
    },
  }
  app = buildServer({ sqlite: openDb(':memory:').sqlite, email: { transport: fakeTransport } })
})

async function seedJobWithDocs(): Promise<string> {
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
      apply_email: 'APAC-Careers@jainglobal.com',
    },
  })
  const jobId = (created.json() as { job: JobRecord }).job.id
  for (const type of ['resume', 'cover_letter'] as const) {
    const gen = await app.inject({ method: 'POST', url: `/api/jobs/${jobId}/generate`, headers: AUTH, payload: { type } })
    expect([200, 202]).toContain(gen.statusCode)
  }
  await app.runner.drain()
  return jobId
}

describe('email apply (SAFE_MODE)', () => {
  it('recipient override cannot be bypassed while SAFE_MODE is on', () => {
    expect(resolveRecipient('APAC-Careers@jainglobal.com')).toEqual({
      to_actual: 'tzkhoo@connect.ust.hk',
      safe_mode: true,
    })
    expect(resolveRecipient('anyone@anywhere.com').to_actual).toBe('tzkhoo@connect.ust.hk')
  })

  it('builds a preview with subject, body, and both attachments', async () => {
    const jobId = await seedJobWithDocs()
    const res = await app.inject({ method: 'GET', url: `/api/jobs/${jobId}/email/preview`, headers: AUTH })
    expect(res.statusCode).toBe(200)
    const draft = res.json() as EmailDraft
    expect(draft.subject).toBe('Application for Quant Researcher Intern')
    expect(draft.body).toContain('Jain Global')
    expect(draft.to_intended).toBe('APAC-Careers@jainglobal.com')
    expect(draft.to_actual).toBe('tzkhoo@connect.ust.hk')
    expect(draft.safe_mode).toBe(true)
    expect(draft.attachments).toHaveLength(2)
    expect(draft.problems).toEqual([])
  })

  it('sends to the SAFE_MODE recipient with two real PDF attachments and records the audit row', async () => {
    const jobId = await seedJobWithDocs()
    const preview = (await app.inject({ method: 'GET', url: `/api/jobs/${jobId}/email/preview`, headers: AUTH })).json() as EmailDraft

    const res = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/email/send`,
      headers: AUTH,
      payload: {
        subject: preview.subject,
        body: preview.body,
        attachment_doc_ids: preview.attachments.map((a) => a.document_id),
      },
    })
    expect(res.statusCode).toBe(200)
    const { record } = res.json() as { record: EmailRecordRow }

    // the wire-level recipient is the override, never the employer
    expect(sentMail).toHaveLength(1)
    expect(sentMail[0].to).toBe('tzkhoo@connect.ust.hk')
    expect(sentMail[0].attachments).toHaveLength(2)
    for (const att of sentMail[0].attachments) {
      expect(fs.existsSync(att.path), att.path).toBe(true)
      expect(fs.readFileSync(att.path).subarray(0, 5).toString('latin1')).toBe('%PDF-')
    }

    expect(record.to_intended).toBe('APAC-Careers@jainglobal.com')
    expect(record.to_actual).toBe('tzkhoo@connect.ust.hk')
    expect(record.safe_mode).toBe(true)

    const history = await app.inject({ method: 'GET', url: `/api/jobs/${jobId}/emails`, headers: AUTH })
    expect((history.json() as { emails: EmailRecordRow[] }).emails).toHaveLength(1)
  }, 60_000)

  it('a hostile payload cannot redirect the send while SAFE_MODE is on', async () => {
    const jobId = await seedJobWithDocs()
    const preview = (await app.inject({ method: 'GET', url: `/api/jobs/${jobId}/email/preview`, headers: AUTH })).json() as EmailDraft
    const res = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/email/send`,
      headers: AUTH,
      payload: {
        to: 'attacker@evil.com',
        subject: 's',
        body: 'b',
        attachment_doc_ids: preview.attachments.map((a) => a.document_id),
      },
    })
    expect(res.statusCode).toBe(200)
    expect(sentMail[0].to).toBe('tzkhoo@connect.ust.hk')
    const { record } = res.json() as { record: EmailRecordRow }
    expect(record.to_intended).toBe('attacker@evil.com')
    expect(record.to_actual).toBe('tzkhoo@connect.ust.hk')
  }, 60_000)

  it('refuses to send with no attachments', async () => {
    const jobId = await seedJobWithDocs()
    const res = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/email/send`,
      headers: AUTH,
      payload: { subject: 's', body: 'b', attachment_doc_ids: [] },
    })
    expect(res.statusCode).toBe(400)
    expect(sentMail).toHaveLength(0)
  })
})
