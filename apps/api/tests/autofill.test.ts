import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import type { FastifyInstance } from 'fastify'
import { MasterProfileSchema, type JobRecord } from '@app/shared'
import {
  classifyFieldDeterministic,
  discoverFields,
  FieldInfoSchema,
  MAX_AUTOFILL_FIELDS,
  prioritizeFields,
  type FieldSuggestion,
} from '@app/shared/autofill'
import { openDb } from '../src/db'
import { buildServer } from '../src/server'

const AUTH = { authorization: 'Bearer test-token' }
const FORM = fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/forms/apply-form.html'), 'utf8')

const formFields = () => discoverFields(new JSDOM(FORM).window.document)

let app: FastifyInstance

beforeAll(() => {
  process.env.API_AUTH_TOKEN = 'test-token'
})

beforeEach(() => {
  app = buildServer({ sqlite: openDb(':memory:').sqlite })
})

describe('field discovery (fixture apply form)', () => {
  it('finds visible fields and skips hidden/submit inputs', () => {
    const fields = formFields()
    expect(fields).toHaveLength(11)
    expect(fields.every((f) => f.input_type !== 'hidden' && f.input_type !== 'submit')).toBe(true)
  })

  it('resolves labels through the label[for] chain and captures maxlength', () => {
    const fields = formFields()
    const why = fields.find((f) => f.name === 'why_role')!
    expect(why.label).toBe('Why do you want this role?')
    expect(why.maxlength).toBe(200)
    const auth = fields.find((f) => f.name === 'work_auth')!
    expect(auth.options).toContain('Require visa sponsorship')
  })
})

describe('tier-1 deterministic classification', () => {
  const mk = (over: Partial<Parameters<typeof FieldInfoSchema.parse>[0]>) =>
    FieldInfoSchema.parse({ selector: '#x', tag: 'input', ...over })

  it('classifies the classics without any model', () => {
    expect(classifyFieldDeterministic(mk({ label: 'Email address' }))).toBe('email')
    expect(classifyFieldDeterministic(mk({ label: 'Contact number' }))).toBe('phone')
    expect(classifyFieldDeterministic(mk({ label: 'Full name' }))).toBe('full_name')
    expect(classifyFieldDeterministic(mk({ label: 'LinkedIn profile' }))).toBe('linkedin_url')
    expect(classifyFieldDeterministic(mk({ label: 'Cover letter' }))).toBe('cover_letter')
    expect(classifyFieldDeterministic(mk({ autocomplete: 'email' }))).toBe('email')
  })

  it('sends every demographic field to SENSITIVE_DO_NOT_FILL, beating other signals', () => {
    // gender left the sensitive bucket by explicit user opt-in (2026-08-12):
    // fills from a saved answer only, never derived or generated
    expect(classifyFieldDeterministic(mk({ label: 'Gender' }))).toBe('gender')
    expect(classifyFieldDeterministic(mk({ label: 'Ethnicity' }))).toBe('SENSITIVE_DO_NOT_FILL')
    expect(classifyFieldDeterministic(mk({ label: 'Race / Ethnicity' }))).toBe('SENSITIVE_DO_NOT_FILL')
    expect(classifyFieldDeterministic(mk({ label: 'Veteran status' }))).toBe('SENSITIVE_DO_NOT_FILL')
    expect(classifyFieldDeterministic(mk({ label: 'Date of birth' }))).toBe('SENSITIVE_DO_NOT_FILL')
    expect(classifyFieldDeterministic(mk({ label: 'Disability status', autocomplete: 'email' }))).toBe('SENSITIVE_DO_NOT_FILL')
  })
})

describe('POST /api/autofill (LLM replayed from fixtures)', () => {
  it('routes answers correctly: direct copy, derived, generative, sensitive, honest-unknown', async () => {
    const profile = MasterProfileSchema.parse(
      JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/generation/profile.json'), 'utf8')),
    )
    await app.inject({ method: 'PUT', url: '/api/profile', headers: AUTH, payload: profile })
    const created = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: AUTH,
      payload: { title: 'Software Engineer', company: 'Acme HK', jd_text: 'Python, TypeScript, cloud.' },
    })
    const jobId = ((created.json() as { job: JobRecord }).job).id

    const res = await app.inject({
      method: 'POST',
      url: '/api/autofill',
      headers: AUTH,
      payload: { fields: formFields(), job_id: jobId },
    })
    expect(res.statusCode).toBe(200)
    const { suggestions } = res.json() as { suggestions: FieldSuggestion[] }
    const by = (name: string) => suggestions.find((s) => s.selector === `#${name}`)!

    // direct copy — straight from profile, zero LLM
    expect(by('name').value).toBe('THIEN ZHI, KHOO')
    expect(by('email').value).toBe('tzkhoo@connect.ust.hk')
    expect(by('phone').value).toBe('+852 4492 4625')

    // derived — latest experience entry, never generated
    expect(by('role').value).toContain('Data Engineering Intern')

    // sensitive — no value, explicit refusal note
    for (const id of ['ethnicity', 'dob']) {
      expect(by(id).do_not_fill, id).toBe(true)
      expect(by(id).value, id).toBeNull()
    }
    // gender is answerable since the user's opt-in — but with no saved
    // answer it stays honestly empty (never derived, never generated)
    expect(by('gender').do_not_fill).toBe(false)
    expect(by('gender').value).toBeNull()

    // generative respects maxlength
    const why = by('why')
    expect(why.value).toBeTruthy()
    expect(why.value!.length).toBeLessThanOrEqual(200)
    const extra = by('extra')
    expect(extra.value!.length).toBeLessThanOrEqual(300)

    // work authorization is a fact we don't hold → no suggestion, never a guess
    expect(by('auth').value).toBeNull()
    expect(by('auth').do_not_fill).toBe(false)
  })

  it('rejects an empty field list', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/autofill', headers: AUTH, payload: { fields: [] } })
    expect(res.statusCode).toBe(400)
  })
})

describe('noisy listing pages (CTgoodjobs regression, 2026-08-11)', () => {
  // A filter sidebar of 120 checkboxes plus a real apply form: discovery finds
  // everything, but the batch sent to the API must keep every fillable control
  // and stay under the cap — the live page 400ed ("at most 100 elements").
  const NOISY_PAGE = `<html><body>
    <aside>${Array.from({ length: 120 }, (_, i) => `<label><input type="checkbox" name="filter_${i}"> Industry ${i}</label>`).join('')}</aside>
    <main>
      <label for="apply-name">Full name</label><input id="apply-name" type="text">
      <label for="apply-email">Email address</label><input id="apply-email" type="email">
      <label for="apply-phone">Contact number</label><input id="apply-phone" type="tel">
      <label for="apply-notice">Notice period</label><input id="apply-notice" type="text">
      <label for="apply-salary">Expected salary</label><input id="apply-salary" type="text">
    </main>
  </body></html>`

  it('prioritization keeps every fillable field and respects the cap', () => {
    const discovered = discoverFields(new JSDOM(NOISY_PAGE).window.document)
    expect(discovered.length).toBeGreaterThan(MAX_AUTOFILL_FIELDS)

    const sent = prioritizeFields(discovered)
    expect(sent.length).toBe(MAX_AUTOFILL_FIELDS)
    // every text-entry control survives, in document order, ahead of the noise
    const textSelectors = sent.filter((f) => f.input_type !== 'checkbox').map((f) => f.selector)
    expect(textSelectors).toEqual(['#apply-name', '#apply-email', '#apply-phone', '#apply-notice', '#apply-salary'])
    expect(sent.slice(0, 5).every((f) => f.input_type !== 'checkbox')).toBe(true)
  })

  it('the prioritized batch passes the API cap that the raw scan blew', async () => {
    const discovered = discoverFields(new JSDOM(NOISY_PAGE).window.document)

    const raw = await app.inject({
      method: 'POST',
      url: '/api/autofill',
      headers: AUTH,
      payload: { fields: discovered, job_id: null },
    })
    expect(raw.statusCode).toBe(400) // the exact live failure

    const res = await app.inject({
      method: 'POST',
      url: '/api/autofill',
      headers: AUTH,
      payload: { fields: prioritizeFields(discovered), job_id: null },
    })
    expect(res.statusCode).toBe(200)
    const { suggestions } = res.json() as { suggestions: FieldSuggestion[] }
    expect(suggestions).toHaveLength(MAX_AUTOFILL_FIELDS)
  })
})
