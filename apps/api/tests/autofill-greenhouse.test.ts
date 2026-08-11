import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import type { FastifyInstance } from 'fastify'
import { MasterProfileSchema } from '@app/shared'
import {
  applyFillToDocument,
  classifyFieldDeterministic,
  discoverFields,
  verifyFill,
  type FieldSuggestion,
} from '@app/shared/autofill'
import type Database from 'better-sqlite3'
import { openDb } from '../src/db'
import { formFingerprint } from '../src/services/autofill'
import { buildServer } from '../src/server'

// The dev-time half of the fill→verify loop: the fixture is the REAL
// server-rendered Greenhouse application form (captured 2026-08-11 from
// boards.greenhouse.io/embed/job_app?for=anthropic), and this eval asserts
// the whole pipeline — discover → classify → suggest → fill → verify —
// lands 100% of the fillable fields. The same applyFillToDocument code runs
// in the extension, so green here means the demo works. If Greenhouse
// drifts, re-capture the fixture and this file says exactly what broke.

const AUTH = { authorization: 'Bearer test-token' }
const FORM = fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/forms/greenhouse-apply.html'), 'utf8')
const OKX = fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/forms/okx-apply.html'), 'utf8')
const CORE = ['#first_name', '#last_name', '#email', '#phone'] as const

let app: FastifyInstance
let sqlite: Database.Database

beforeAll(() => {
  process.env.API_AUTH_TOKEN = 'test-token'
})

beforeEach(() => {
  sqlite = openDb(':memory:').sqlite
  app = buildServer({ sqlite })
})

async function loadProfile(): Promise<void> {
  const profile = MasterProfileSchema.parse(
    JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/generation/profile.json'), 'utf8')),
  )
  await app.inject({ method: 'PUT', url: '/api/profile', headers: AUTH, payload: profile })
}

describe('Greenhouse application form (real captured HTML)', () => {
  it('discovers the contact fields and skips framework junk', () => {
    const fields = discoverFields(new JSDOM(FORM).window.document)
    const selectors = fields.map((f) => f.selector)
    for (const sel of CORE) expect(selectors).toContain(sel)
    // the file input and react-select's aria-hidden "required" proxy input
    // are framework internals, not fields
    expect(fields.every((f) => f.input_type !== 'file')).toBe(true)
    expect(selectors.every((s) => !s.startsWith('[data-hy-field'))).toBe(true)
    // labels resolve through label[for], with the required-asterisk stripped
    expect(fields.find((f) => f.selector === '#first_name')!.label).toBe('First Name')
    expect(fields.find((f) => f.selector === '#last_name')!.label).toBe('Last Name')
  })

  it('classifies every contact field without a model', () => {
    const fields = discoverFields(new JSDOM(FORM).window.document)
    const canon = new Map(fields.map((f) => [f.selector, classifyFieldDeterministic(f)]))
    expect(canon.get('#first_name')).toBe('first_name')
    expect(canon.get('#last_name')).toBe('last_name')
    expect(canon.get('#email')).toBe('email')
    expect(canon.get('#phone')).toBe('phone')
  })

  it('fills 100% of suggested fields, verified by reading the DOM back', async () => {
    await loadProfile()

    const doc = new JSDOM(FORM).window.document
    const fields = discoverFields(doc)
    const res = await app.inject({
      method: 'POST',
      url: '/api/autofill',
      headers: AUTH,
      payload: { fields, job_id: null },
    })
    expect(res.statusCode).toBe(200)
    const { suggestions } = res.json() as { suggestions: FieldSuggestion[] }

    const outcomes = applyFillToDocument(doc, suggestions)

    // the loop's metric: every field we claimed a value for is verifiably set
    const attempted = outcomes.filter((o) => o.status !== 'skipped')
    expect(attempted.length).toBeGreaterThanOrEqual(CORE.length)
    for (const o of attempted) expect(o.status, `${o.label}: ${o.reason ?? ''}`).toBe('filled')

    const value = (sel: string) => (doc.querySelector(sel) as HTMLInputElement).value
    expect(value('#first_name')).toBe('THIEN ZHI')
    expect(value('#last_name')).toBe('KHOO')
    expect(value('#email')).toBe('tzkhoo@connect.ust.hk')
    expect(value('#phone')).toBe('+852 4492 4625')

    // the independent verification pass agrees: fill rate 1.0
    const verified = verifyFill(doc, suggestions)
    expect(verified.length).toBeGreaterThan(0)
    expect(verified.filter((v) => v.ok).length / verified.length).toBe(1)

    // react-select comboboxes are reported for manual entry, never mangled
    const combo = outcomes.find((o) => o.selector === '#country')
    expect(combo?.status).toBe('skipped')
  })
})

describe('OKX Hong Kong application form (real captured HTML — primary demo target)', () => {
  it('classifies the rich field set — contact, location, education, links — without a model', () => {
    const fields = discoverFields(new JSDOM(OKX).window.document)
    const canon = new Map(fields.map((f) => [f.selector, classifyFieldDeterministic(f)]))
    expect(canon.get('#first_name')).toBe('first_name')
    expect(canon.get('#last_name')).toBe('last_name')
    expect(canon.get('#email')).toBe('email')
    expect(canon.get('#phone')).toBe('phone')
    expect(canon.get('#candidate-location')).toBe('location')
    expect(canon.get('#school--0')).toBe('education_institution')
    expect(canon.get('#degree--0')).toBe('degree')
    expect(canon.get('#question_30715330003')).toBe('linkedin_url') // "LinkedIn Profile"
    expect(canon.get('#question_30715331003')).toBe('portfolio_url') // "Website"
    // "notice period to your CURRENT EMPLOYER" must NOT hit the employer rule
    expect(canon.get('#question_30715333003')).toBe('notice_period')
  })

  it('fills the whole contact + education block, 100% verified, checkboxes untouched', async () => {
    await loadProfile()

    const doc = new JSDOM(OKX).window.document
    const fields = discoverFields(doc)
    const res = await app.inject({
      method: 'POST',
      url: '/api/autofill',
      headers: AUTH,
      payload: { fields, job_id: null },
    })
    expect(res.statusCode).toBe(200)
    const { suggestions } = res.json() as { suggestions: FieldSuggestion[] }

    const outcomes = applyFillToDocument(doc, suggestions)
    const attempted = outcomes.filter((o) => o.status !== 'skipped')
    expect(attempted.length).toBeGreaterThanOrEqual(4)
    for (const o of attempted) expect(o.status, `${o.label}: ${o.reason ?? ''}`).toBe('filled')

    const value = (sel: string) => (doc.querySelector(sel) as HTMLInputElement).value
    expect(value('#first_name')).toBe('THIEN ZHI')
    expect(value('#last_name')).toBe('KHOO')
    expect(value('#email')).toBe('tzkhoo@connect.ust.hk')
    expect(value('#phone')).toBe('+852 4492 4625')

    // school/degree are react-select comboboxes: static fill skips them, but
    // the suggestions MUST carry values — the extension's combobox pass types
    // these into the live dropdown and verifies the rendered selection.
    const by = (sel: string) => suggestions.find((s) => s.selector === sel)!
    expect(by('#school--0').value).toBe('The Hong Kong University of Science and Technology')
    expect(by('#degree--0').value).toBe('BEng in Computer Engineering and minor in Business (Year 4)')
    const schoolOutcome = outcomes.find((o) => o.selector === '#school--0')!
    expect(schoolOutcome.status).toBe('skipped')
    expect(schoolOutcome.value).toBeTruthy()

    const verified = verifyFill(doc, suggestions)
    expect(verified.length).toBeGreaterThanOrEqual(4)
    expect(verified.filter((v) => v.ok).length / verified.length).toBe(1)

    // the 31 language checkboxes stay untouched
    const boxes = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type=checkbox]'))
    expect(boxes.length).toBeGreaterThan(20)
    expect(boxes.every((b) => !b.checked)).toBe(true)
  })

  it('stores application answers (answerable keys only) and feeds them into suggestions', async () => {
    await loadProfile()
    const put = await app.inject({
      method: 'PUT',
      url: '/api/answers',
      headers: AUTH,
      payload: {
        answers: {
          notice_period: 'Available immediately',
          visa_sponsorship_required: 'No',
          linkedin_url: 'https://linkedin.com/in/tzkhoo',
          gender: 'must never persist', // not a canonical key
          SENSITIVE_DO_NOT_FILL: 'must never persist', // canonical but not answerable
          years_experience: '   ', // blank → dropped
        },
      },
    })
    expect(put.statusCode).toBe(200)
    const got = await app.inject({ method: 'GET', url: '/api/answers', headers: AUTH })
    expect((got.json() as { answers: Record<string, string> }).answers).toEqual({
      notice_period: 'Available immediately',
      visa_sponsorship_required: 'No',
      linkedin_url: 'https://linkedin.com/in/tzkhoo',
    })

    const fields = discoverFields(new JSDOM(OKX).window.document)
    const res = await app.inject({ method: 'POST', url: '/api/autofill', headers: AUTH, payload: { fields, job_id: null } })
    const { suggestions } = res.json() as { suggestions: FieldSuggestion[] }
    const by = (sel: string) => suggestions.find((s) => s.selector === sel)!
    expect(by('#question_30715333003').value).toBe('Available immediately') // notice period
    expect(by('#question_30715332003').value).toBe('No') // visa sponsorship
    expect(by('#question_30715330003').value).toBe('https://linkedin.com/in/tzkhoo')
    // an unanswered answerable field points the user at the answers page
    expect(by('#question_30715331003').value).toBeNull() // website
    expect(by('#question_30715331003').note).toContain('Autofill answers')
  })

  it('caches classifications per form shape and trusts the cache over re-deriving', async () => {
    await loadProfile()
    const fields = discoverFields(new JSDOM(OKX).window.document)
    const payload = { fields, job_id: null }

    // first scan primes the cache
    await app.inject({ method: 'POST', url: '/api/autofill', headers: AUTH, payload })
    const fp = formFingerprint(fields)
    const row = sqlite
      .prepare(`SELECT classifications_json FROM autofill_form_cache WHERE form_fingerprint = ?`)
      .get(fp) as { classifications_json: string } | undefined
    expect(row).toBeDefined()
    expect(JSON.parse(row!.classifications_json)['#email']).toBe('email')

    // tamper with the cached map — the next scan must reflect the cache,
    // proving repeat scans never re-derive (and never need the LLM)
    const tampered = { ...JSON.parse(row!.classifications_json), '#email': 'UNKNOWN' }
    sqlite
      .prepare(`UPDATE autofill_form_cache SET classifications_json = ? WHERE form_fingerprint = ?`)
      .run(JSON.stringify(tampered), fp)
    const res = await app.inject({ method: 'POST', url: '/api/autofill', headers: AUTH, payload })
    const { suggestions } = res.json() as { suggestions: FieldSuggestion[] }
    expect(suggestions.find((s) => s.selector === '#email')!.value).toBeNull()
    expect(suggestions.find((s) => s.selector === '#first_name')!.value).toBe('THIEN ZHI')
  })
})
