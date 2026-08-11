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
import { buildServer } from '../src/server'

// Corporate-ATS eval #2 (after Greenhouse): the REAL Palantir application form
// on Lever, captured 2026-08-11 from jobs.lever.co/palantir/<id>/apply. Lever
// is server-rendered classic HTML — labels resolve through the
// preceding-sibling chain (.application-label before .application-field).
// This form also exposed three live classifier bugs, all regression-locked
// here: "Telugu (TEL)" checkbox → phone, "pronounce your name" → full_name,
// and "how you heard about" missing the referral rule.

const AUTH = { authorization: 'Bearer test-token' }
const FORM = fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/forms/lever-apply.html'), 'utf8')
const CORE = ['input[name="name"]', 'input[name="email"]', 'input[name="phone"]', '#location-input'] as const
// the frozen profile fixture has an empty contact.location — the pipeline must
// skip that field honestly (no guess), so it's asserted separately from fills
const FILLABLE = CORE.slice(0, 3)

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

describe('Lever application form (real captured Palantir HTML)', () => {
  it('discovers the classic Lever fields and skips file/hidden internals', () => {
    const fields = discoverFields(new JSDOM(FORM).window.document)
    const selectors = fields.map((f) => f.selector)
    for (const sel of CORE) expect(selectors).toContain(sel)
    expect(selectors).toContain('input[name="org"]')
    expect(selectors).toContain('input[name="urls[LinkedIn]"]')
    // resume file input, captcha and tracking hiddens are not fields
    expect(fields.every((f) => f.input_type !== 'file')).toBe(true)
    expect(selectors.every((s) => !/resume|captcha|accountId|origin/.test(s))).toBe(true)
  })

  it('classifies the whole Lever vocabulary without a model', () => {
    const fields = discoverFields(new JSDOM(FORM).window.document)
    const canon = new Map(fields.map((f) => [f.selector, classifyFieldDeterministic(f)]))
    expect(canon.get('input[name="name"]')).toBe('full_name')
    expect(canon.get('input[name="email"]')).toBe('email')
    expect(canon.get('input[name="phone"]')).toBe('phone')
    expect(canon.get('#location-input')).toBe('location')
    expect(canon.get('input[name="org"]')).toBe('current_company')
    expect(canon.get('input[name="urls[LinkedIn]"]')).toBe('linkedin_url')
    expect(canon.get('input[name="urls[GitHub]"]')).toBe('github_url')
    expect(canon.get('input[name="urls[Portfolio]"]')).toBe('portfolio_url')
    // custom question cards
    const byLabel = (needle: RegExp) => {
      const f = fields.find((x) => needle.test(x.label))
      return f ? canon.get(f.selector) : undefined
    }
    expect(byLabel(/which university/i)).toBe('education_institution')
    expect(byLabel(/how you heard about/i)).toBe('referral_source')
    expect(byLabel(/why do you want to work at palantir/i)).toBe('why_this_company')
    // Lever's "Additional information" box literally invites a cover letter
    expect(canon.get('#additional-information')).toBe('cover_letter')
  })

  it('regression: tick-boxes and pronunciation fields never classify to value-bearing canonicals', () => {
    const fields = discoverFields(new JSDOM(FORM).window.document)
    // "Telugu (TEL)" used to hit the phone rule; every language checkbox is UNKNOWN
    const tickBoxes = fields.filter((f) => f.input_type === 'checkbox' || f.input_type === 'radio')
    expect(tickBoxes.length).toBeGreaterThan(30)
    for (const f of tickBoxes) {
      const canonical = classifyFieldDeterministic(f)
      expect(['UNKNOWN', 'SENSITIVE_DO_NOT_FILL'], `${f.label} -> ${canonical}`).toContain(canonical)
    }
    // "How do you pronounce your name?" used to classify (and fill!) as full_name
    const pronunciation = fields.find((f) => /pronounce your name/i.test(f.label))!
    expect(classifyFieldDeterministic(pronunciation)).toBe('UNKNOWN')
  })

  it('fills the core contact fields from the profile, verified by DOM read-back', async () => {
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

    const by = (sel: string) => suggestions.find((s) => s.selector === sel)!
    expect(by('input[name="name"]').value).toBe('THIEN ZHI, KHOO')
    expect(by('input[name="email"]').value).toBe('tzkhoo@connect.ust.hk')
    expect(by('input[name="phone"]').value).toBe('+852 4492 4625')
    // derived from the profile's education entry, never generated
    expect(by('select[name="cards[3da58b41-acf5-40a1-945e-c7f047ef8050][field0]"]').value).toMatch(/hong kong/i)
    // generative fields get nothing without a job context — no hallucinated essays
    expect(by('#additional-information').value).toBeNull()

    const outcomes = applyFillToDocument(doc, suggestions)
    const outcome = new Map(outcomes.map((o) => [o.selector, o]))
    for (const sel of FILLABLE) expect(outcome.get(sel)?.status, sel).toBe('filled')
    // empty profile field → no suggestion → honest skip, never a guess
    expect(by('#location-input').value).toBeNull()
    expect(outcome.get('#location-input')?.status).toBe('skipped')
    // tick-boxes are reported, never ticked
    for (const o of outcomes) {
      const f = fields.find((x) => x.selector === o.selector)
      if (f && (f.input_type === 'checkbox' || f.input_type === 'radio')) {
        expect(o.status, o.selector).toBe('skipped')
      }
    }

    const verified = new Map(verifyFill(doc, suggestions).map((v) => [v.selector, v.ok]))
    for (const sel of FILLABLE) expect(verified.get(sel), sel).toBe(true)
  })
})
