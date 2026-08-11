import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { MasterProfile } from '@app/shared'
import { openDb } from '../src/db'
import { buildServer } from '../src/server'
import { extractPdfText } from '../src/services/cvExtract'

const AUTH = { authorization: 'Bearer test-token' }
const CV_PATH = path.resolve(process.cwd(), 'tests/fixtures/cv/thien-zhi-cv.pdf')

let app: FastifyInstance

beforeAll(() => {
  process.env.API_AUTH_TOKEN = 'test-token'
})

beforeEach(() => {
  app = buildServer({ sqlite: openDb(':memory:').sqlite })
})

function multipartPayload(content: Buffer, filename = 'cv.pdf', contentType = 'application/pdf') {
  const boundary = '----vitestboundary42'
  return {
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${filename}"\r\ncontent-type: ${contentType}\r\n\r\n`,
      ),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    headers: { ...AUTH, 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

describe('CV text extraction (real CV fixture)', () => {
  // pdfjs takes ~1s alone but 7s+ when the full suite runs in parallel on a
  // loaded machine — the default 5s timeout flakes, the assertion never does
  it('recovers the text layer in reading order', { timeout: 30_000 }, async () => {
    const result = await extractPdfText(new Uint8Array(fs.readFileSync(CV_PATH)))
    expect(result.pages).toBe(1)
    expect(result.warnings).toEqual([])
    expect(result.text).toContain('tzkhoo@connect.ust.hk')
    expect(result.text).toContain('KHOO')
    expect(result.text.toLowerCase()).toContain('hong kong university of science and technology')
    expect(result.text).toContain('Wonder')
  })
})

describe('POST /api/profile/parse-cv (LLM replayed from fixture)', () => {
  it('returns a structured draft without persisting anything', async () => {
    const { payload, headers } = multipartPayload(fs.readFileSync(CV_PATH))
    const res = await app.inject({ method: 'POST', url: '/api/profile/parse-cv', payload, headers })
    expect(res.statusCode).toBe(200)

    const { draft } = res.json() as { draft: MasterProfile }
    expect(draft.contact.email).toBe('tzkhoo@connect.ust.hk')
    expect(draft.contact.full_name.toUpperCase()).toContain('KHOO')
    expect(draft.sections.length).toBeGreaterThanOrEqual(4)
    const types = new Set(draft.sections.map((s) => s.type))
    expect(types.has('experience')).toBe(true)
    const orgs = draft.sections
      .filter((s) => s.type === 'experience')
      .flatMap((s) => (s.type === 'experience' ? s.content.entries.map((e) => e.organisation) : []))
    expect(orgs.join(' ')).toContain('Wonder')

    // nothing persisted: profile still empty
    const profile = await app.inject({ method: 'GET', url: '/api/profile', headers: AUTH })
    expect((profile.json() as MasterProfile).sections).toEqual([])
  })

  it('rejects a non-PDF upload', async () => {
    const { payload, headers } = multipartPayload(Buffer.from('just some text'), 'cv.txt', 'text/plain')
    const res = await app.inject({ method: 'POST', url: '/api/profile/parse-cv', payload, headers })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('not_a_pdf')
  })

  it('rejects a PDF larger than 2 MB', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2 * 1024 * 1024 + 1024, 0x20)])
    const { payload, headers } = multipartPayload(big)
    const res = await app.inject({ method: 'POST', url: '/api/profile/parse-cv', payload, headers })
    // 413 comes straight from the multipart size limit
    expect(res.statusCode).toBe(413)
  })
})
