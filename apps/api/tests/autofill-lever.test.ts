import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import type { FastifyInstance } from 'fastify'
import { JobInputSchema, MasterProfileSchema } from '@app/shared'
import {
  applyFillToDocument,
  classifyFieldDeterministic,
  discoverFields,
  verifyFill,
  type FieldSuggestion,
} from '@app/shared/autofill'
import type Database from 'better-sqlite3'
import { openDb } from '../src/db'
import { suggestForFields } from '../src/services/autofill'
import { saveProfile } from '../src/services/profile'
import { saveAnswers } from '../src/services/answers'
import { createJob } from '../src/services/jobs'
import { buildServer } from '../src/server'

// Corporate-ATS eval #2 (after Greenhouse): the REAL Palantir application form
// on Lever, captured 2026-08-11 from jobs.lever.co/palantir/<id>/apply.
// This is the FULL-AUTOFILL eval: with the profile, the 17 saved answers and
// a job context, every field that can honestly be answered must get a value —
// including the work-authorization and visa radio GROUPS, which arrive as one
// field carrying the actual question. LLM fixtures live-recorded 2026-08-11
// (re-record: LLM_MODE=record npx tsx scripts/record-lever-autofill.ts).

const AUTH = { authorization: 'Bearer test-token' }
const FORM = fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/forms/lever-apply.html'), 'utf8')
const FILLABLE = ['input[name="name"]', 'input[name="email"]', 'input[name="phone"]'] as const
const WORK_AUTH = 'input[name="cards[1c719ca9-5069-4afe-9e82-39ca420e0edb][field0]"]'
const VISA = 'input[name="cards[1c719ca9-5069-4afe-9e82-39ca420e0edb][field1]"]'
const AI_CONSENT = 'input[name="cards[73796cde-fc01-4758-9002-c85155f3503d][field0]"]'

// mirrors what the user saves on the Autofill answers page
const ANSWERS = {
  linkedin_url: 'https://linkedin.com/in/thienzhi',
  github_url: 'https://github.com/thienzhi',
  portfolio_url: 'https://thienzhi.dev',
  work_authorization: 'Yes — Hong Kong resident, no work permit needed',
  visa_sponsorship_required: 'No',
  referral_source: 'LinkedIn',
  name_pronunciation: 'TEEN-zhee KOO',
  proudest_accomplishment:
    'Built a production data pipeline during my internship that cut reporting latency from hours to minutes.',
}

let app: FastifyInstance
let sqlite: Database.Database

beforeAll(() => {
  process.env.API_AUTH_TOKEN = 'test-token'
})

beforeEach(() => {
  sqlite = openDb(':memory:').sqlite
  app = buildServer({ sqlite })
})

const loadProfile = () =>
  saveProfile(
    sqlite,
    MasterProfileSchema.parse(
      JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/generation/profile.json'), 'utf8')),
    ),
  )

// full-page discovery over the real capture sits near the 15s global timeout
// under parallel load (jsdom getComputedStyle + deep label walks per element)
// — whole-suite headroom, same flake class the global bump addressed
describe('Lever application form (real captured Palantir HTML)', { timeout: 60_000 }, () => {
  it('discovers classic Lever fields, collapses radio groups, skips internals', () => {
    const fields = discoverFields(new JSDOM(FORM).window.document)
    const selectors = fields.map((f) => f.selector)
    for (const sel of [...FILLABLE, 'input[name="org"]', 'input[name="urls[LinkedIn]"]']) {
      expect(selectors).toContain(sel)
    }
    // radio groups arrive ONCE, carrying the real question and the options
    const workAuth = fields.find((f) => f.selector === WORK_AUTH)!
    expect(workAuth.input_type).toBe('radio')
    expect(workAuth.label).toMatch(/legally authorized to work/i)
    expect(workAuth.options).toEqual(['Yes', 'No'])
    const visa = fields.find((f) => f.selector === VISA)!
    expect(visa.label).toMatch(/require sponsorship/i)
    expect(selectors.filter((s) => s === WORK_AUTH)).toHaveLength(1)
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
    // radio groups classify from their question
    expect(canon.get(WORK_AUTH)).toBe('work_authorization')
    expect(canon.get(VISA)).toBe('visa_sponsorship_required')
    // custom question cards
    const byLabel = (needle: RegExp) => {
      const f = fields.find((x) => needle.test(x.label))
      return f ? canon.get(f.selector) : undefined
    }
    expect(byLabel(/preferred name/i)).toBe('preferred_name')
    expect(byLabel(/pronounce your name/i)).toBe('name_pronunciation')
    expect(byLabel(/favorite project or proudest/i)).toBe('proudest_accomplishment')
    expect(byLabel(/which university/i)).toBe('education_institution')
    expect(byLabel(/how you heard about/i)).toBe('referral_source')
    expect(byLabel(/why do you want to work at palantir/i)).toBe('why_this_company')
    // Lever's "Additional information" box literally invites a cover letter
    expect(canon.get('#additional-information')).toBe('cover_letter')
  })

  it('regression: checkboxes never classify to value-bearing canonicals', () => {
    const fields = discoverFields(new JSDOM(FORM).window.document)
    // "Telugu (TEL)" used to hit the phone rule
    const checkboxes = fields.filter((f) => f.input_type === 'checkbox')
    expect(checkboxes.length).toBeGreaterThan(30)
    for (const f of checkboxes) {
      const canonical = classifyFieldDeterministic(f)
      expect(['UNKNOWN', 'SENSITIVE_DO_NOT_FILL'], `${f.label} -> ${canonical}`).toContain(canonical)
    }
  })

  it('FULL AUTOFILL: everything honestly answerable gets a value and fills, radio groups included', async () => {
    loadProfile()
    saveAnswers(sqlite, ANSWERS)
    const jd = fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/generation/palantir-jd.txt'), 'utf8')
    const { job } = createJob(
      sqlite,
      JobInputSchema.parse({ title: 'Software Engineer Intern', company: 'Palantir', jd_text: jd }),
    )

    const doc = new JSDOM(FORM).window.document
    const fields = discoverFields(doc)
    const suggestions = await suggestForFields(sqlite, fields, job, {
      classify: 'lever-classify',
      answers: 'lever-answers',
    })
    const by = (sel: string) => suggestions.find((s) => s.selector === sel)!

    // the only fields WITHOUT a value must be: checkboxes (never ticked),
    // the AI-notetaker consent radio (consent stays human), and location
    // (empty in the frozen profile fixture — fills from a real profile)
    const fieldBySel = new Map(fields.map((f) => [f.selector, f]))
    for (const s of suggestions) {
      const f = fieldBySel.get(s.selector)!
      const exempt = f.input_type === 'checkbox' || s.selector === AI_CONSENT || s.selector === '#location-input'
      if (!exempt) expect(s.value, `${f.label || s.selector} should have a value`).toBeTruthy()
    }

    // radio groups answer from saved answers
    expect(by(WORK_AUTH).value).toMatch(/^Yes/)
    expect(by(VISA).value).toBe('No')
    // derived + saved-answer questions
    expect(by('input[name="cards[a69a985a-eae9-4c14-90fb-b5a4b891523e][field1]"]').value).toBe('THIEN ZHI')
    expect(by('input[name="cards[a69a985a-eae9-4c14-90fb-b5a4b891523e][field2]"]').value).toBe('TEEN-zhee KOO')
    // essays are real generated prose (recorded live), not placeholders
    expect(by('textarea[name="cards[ce72d538-c9ad-41f3-8e9a-618d40c82e3a][field1]"]').value!.length).toBeGreaterThan(50)
    expect(by('#additional-information').value!.length).toBeGreaterThan(50)

    // fill + verify against the DOM
    const outcomes = applyFillToDocument(doc, suggestions)
    const outcome = new Map(outcomes.map((o) => [o.selector, o]))
    for (const sel of FILLABLE) expect(outcome.get(sel)?.status, sel).toBe('filled')
    expect(outcome.get(WORK_AUTH)?.status).toBe('filled')
    expect(outcome.get(VISA)?.status).toBe('filled')

    // the RIGHT radio is checked in the DOM
    const checkedLabel = (sel: string) => {
      const radios = Array.from(doc.querySelectorAll<HTMLInputElement>(sel))
      return (radios.find((r) => r.checked)?.closest('label')?.textContent ?? '').trim()
    }
    expect(checkedLabel(WORK_AUTH)).toBe('Yes')
    expect(checkedLabel(VISA)).toBe('No')
    // consent radio untouched
    expect(checkedLabel(AI_CONSENT)).toBe('')

    const verified = new Map(verifyFill(doc, suggestions).map((v) => [v.selector, v.ok]))
    for (const sel of [...FILLABLE, WORK_AUTH, VISA]) expect(verified.get(sel), sel).toBe(true)
  })

  it('without a job context, essays stay empty — no hallucinated enthusiasm', async () => {
    loadProfile()
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
    expect(by('textarea[name="cards[ce72d538-c9ad-41f3-8e9a-618d40c82e3a][field1]"]').value).toBeNull()
    expect(by('#additional-information').value).toBeNull()
    // contact facts still fill
    expect(by('input[name="name"]').value).toBe('THIEN ZHI, KHOO')
  })
})
