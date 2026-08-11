import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import type { FastifyInstance } from 'fastify'
import { MasterProfileSchema } from '@app/shared'
import {
  ANSWER_QUESTIONS,
  applyFillToDocument,
  classifyFieldDeterministic,
  discoverFields,
  FieldInfoSchema,
  verifyFill,
  type FieldSuggestion,
} from '@app/shared/autofill'
import type Database from 'better-sqlite3'
import { openDb } from '../src/db'
import { buildServer } from '../src/server'
import { suggestForFields } from '../src/services/autofill'
import { saveProfile } from '../src/services/profile'

const AUTH = { authorization: 'Bearer test-token' }

// PwC campus application on MokaHR, 2026-08-11 — question list transcribed
// verbatim from the user's live run (the site is unreachable from this
// machine, so the labels ARE the fixture). Every non-sensitive question must
// classify deterministically; sensitive ones must stay hard-blocked.

const mk = (label: string, over: Record<string, unknown> = {}) =>
  FieldInfoSchema.parse({ selector: '#x', tag: 'input', label, ...over })

// verbatim widget anatomy from the user's live capture 2026-08-11: a plain
// text input inside an sd-Select-container label — NO combobox ARIA at all.
// Typing into it as a text field filters the menu without committing.
const WIDGET = `<html><body>
  <div class="apply-field-Q2iJ7AtQGX select_info-zjdod05hST">
    <div class="title-IWWQ0Xa4L7"><span><span lang="en-US">Have you been employed by PwC China before(including internship)?</span></span></div>
    <div class="ctrl-CICMG4Fr4_"><div class="sd-Tooltip-container-2zU-8 w-full-mRUtzMQLHs">
      <div class="sd-Dropdown-container-282zZ" style="width: 100%;">
        <label class="sd-Input-container-3OoVt sd-Select-container-D6nZH select_info sd-Input-lg-39_0c" style="width: 100%;">
          <span class="sd-Input-display-value-1RTHN sd-Input-display-value-spacing-bhYPY"></span>
          <input type="text" class="sd-Input-input-QsLkW sd-Input-common-input-21SDH sd-Input-has-addon-SMZCZ" placeholder="Please select" autocomplete="nope" maxlength="-1" value="" id="pwc-employed">
          <span class="sd-Input-addon-29hJw sd-Select-addon-3AtZz"><span class="sd-Icon-container-18tcO sd-Icon-iconcaretDown-C6PEX"></span></span>
        </label>
        <span><div class="sd-Dropdown-dropdown-1c-rG"><div class="sd-Select-menu-UbIS2"><div class="sd-Select-scrollable-1FoVy">
          <div class="sd-Menu-container-3HY1z"><div class="sd-Menu-content-2vKOA"><div class="sd-Menu-content-item-37fPj"><span>Yes</span></div></div></div>
          <div class="sd-Menu-container-3HY1z"><div class="sd-Menu-content-2vKOA"><div class="sd-Menu-content-item-37fPj"><span>No</span></div></div></div>
        </div></div></div></span>
      </div>
    </div></div>
  </div>
</body></html>`

let sqlite: Database.Database

beforeAll(() => {
  process.env.API_AUTH_TOKEN = 'test-token'
})

beforeEach(() => {
  sqlite = openDb(':memory:').sqlite
})

describe('PwC/MokaHR question vocabulary (transcribed live labels)', () => {
  const CASES: [string, string][] = [
    // opportunity preferences
    ['Please confirm which programme you are interested in-FY27 Winter Intern&Sprinter', 'programme_interest'],
    ['Are you willing to consider other opportunities-FY27 Winter Intern&Sprinter', 'open_to_other_opportunities'],
    ['Do you require work authorisation or visa for the preferred opportunities you selected?', 'visa_sponsorship_required'],
    // personal info
    ['Family name in Chinese (e.g. 韩, pls input N/A if not applicable)', 'family_name_chinese'],
    ['Given name in Chinese (e.g. 梅梅,  pls input N/A if not applicable)', 'given_name_chinese'],
    ['Family Name in English (e.g., Han)', 'last_name'],
    ['Given name in English (e.g., Meimei)', 'first_name'],
    ['Preferred English name (e.g. Peter)', 'preferred_name'],
    ['Mobile', 'phone'],
    ['Secondary contact number-Country/Region Code', 'phone_country_code'],
    ['Secondary contact number', 'phone'],
    ['Country/Region (Citizenship)', 'citizenship'],
    ['Citizenship Status', 'citizenship_status'],
    ['Country/Region of Birth', 'country_of_birth'],
    ['Current Country/Region', 'location'],
    [
      'When do you anticipate receiving the certificates of graduation for the highest educational degree, which is including but not limited to: certificate of graduation, official school transcript, academic certificate or the relevant proof of completion)?',
      'graduation_date',
    ],
    // education
    ['School or University', 'education_institution'],
    ['Country/Region of School', 'school_country'],
    ['In which of the following categories does your degree fall?', 'degree'],
    ['Major', 'major'],
    ['What is your major type?', 'major_type'],
    ['Academic Ranking', 'academic_ranking'],
    // sub-fields revealed by the "Cumulative GPA" ranking choice (user's live run)
    ['Cumulative GPA (e.g. 3.75', 'gpa'],
    ['Out of (e.g. 4)', 'gpa_scale'],
    // work experience
    ['Department', 'department'],
    ['Responsibilities', 'responsibilities'],
    ['Employee Type', 'employee_type'],
    // languages & skills
    ['Mandarin proficiency', 'mandarin_proficiency'],
    ['Cantonese proficiency', 'cantonese_proficiency'],
    ['English proficiency', 'english_proficiency'],
    ['Name of public English examination', 'english_exam'],
    ['Other language(s) are you fluent in?', 'languages'],
    ['Skill', 'skills'],
    ['Professional qualification', 'professional_qualification'],
    // employer screeners
    [
      'b)Are you a respondent in a government-initiated civil proceeding, or an administrative or disciplinary proceeding, arising out of conduct in the course of providing professional or business services?',
      'legal_declarations',
    ],
    [
      'e)Have you ever been involved in a labour dispute or any other violation of employer regulations during your work experience as described above?',
      'legal_declarations',
    ],
    [
      'Are you related to a PwC partner, principal, or employee? If yes, please provide his/her full name & PwC email and your relationship to the individual.',
      'related_to_employee',
    ],
    ['Have you been employed by PwC China before(including internship)?', 'previously_employed_here'],
    ['From which channel did you learn about this opportunity?', 'referral_source'],
  ]

  it.each(CASES)('%s → %s', (label, expected) => {
    expect(classifyFieldDeterministic(mk(label))).toBe(expected)
  })

  it('sensitive PwC questions stay hard-blocked', () => {
    for (const label of [
      'Gender',
      'Date of Birth',
      'a)Are you a defendant in a criminal proceeding arising from the rendition of any professional or business services, or involving allegations of fraud or dishonesty?',
      'Have you ever been convicted of an offence by a court of law?',
    ]) {
      expect(classifyFieldDeterministic(mk(label)), label).toBe('SENSITIVE_DO_NOT_FILL')
    }
  })

  it('every answerable canonical is on the answers page exactly once', () => {
    const keys = ANSWER_QUESTIONS.map((q) => q.key)
    expect(new Set(keys).size).toBe(keys.length)
    // 44 = 39 + location/degree/major_type (derived-value overrides)
    //         + gpa/gpa_scale (PwC's ranking pop-out sub-fields)
    expect(keys.length).toBe(44)
  })
})

describe('split phone widgets (PwC mobile truncation regression)', () => {
  it('strips the country code from phone when the form has a code select', async () => {
    saveProfile(
      sqlite,
      MasterProfileSchema.parse(
        JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/generation/profile.json'), 'utf8')),
      ),
    )
    const fields = [
      mk('Mobile', { selector: '#mobile', input_type: 'tel' }),
      mk('Secondary contact number-Country/Region Code', { selector: '#code', tag: 'select', options: ['+852', '+86', '+60'] }),
    ]
    const suggestions = await suggestForFields(sqlite, fields, null)
    const by = (sel: string) => suggestions.find((s) => s.selector === sel)!
    // local part only, separators stripped — MokaHR number inputs stop at spaces
    expect(by('#mobile').value).toBe('44924625')
    expect(by('#code').value).toBe('+852')
  })

  it('keeps the full number when no code select exists', async () => {
    saveProfile(
      sqlite,
      MasterProfileSchema.parse(
        JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/generation/profile.json'), 'utf8')),
      ),
    )
    const suggestions = await suggestForFields(sqlite, [mk('Mobile', { selector: '#mobile', input_type: 'tel' })], null)
    expect(suggestions[0].value).toBe('+852 4492 4625')
  })
})

describe('MokaHR select widgets (exact structure from the captured PwC page)', () => {
  it('detects the ARIA-free select input as a combobox and never types into it', () => {
    const doc = new JSDOM(WIDGET).window.document
    const fields = discoverFields(doc)
    const field = fields.find((f) => f.selector === '#pwc-employed')!
    expect(field).toBeDefined()
    expect(classifyFieldDeterministic(field)).toBe('previously_employed_here')
    // the closed widget's menu is parked in the DOM — scan-time discovery
    // reads the real choices, same as a native select
    expect(field.options).toEqual(['Yes', 'No'])

    const suggestions: FieldSuggestion[] = [
      { selector: '#pwc-employed', canonical: 'previously_employed_here', label: field.label, value: 'No', do_not_fill: false },
    ]
    const [outcome] = applyFillToDocument(doc, suggestions)
    // pass 1 must hand it to the combobox driver, not type into the input
    expect(outcome.status).toBe('skipped')
    expect(outcome.reason).toMatch(/dropdown/i)
    expect((doc.querySelector('#pwc-employed') as HTMLInputElement).value).toBe('')
  })
})

describe('date-part selects (PwC education period / graduation widgets)', () => {
  const PAGE = `<html><body>
    <label for="grad-year">Graduation year</label>
    <select id="grad-year"><option value="">Please select</option>${[2024, 2025, 2026, 2027]
      .map((y) => `<option>${y}</option>`)
      .join('')}</select>
    <label for="grad-month">Graduation month</label>
    <select id="grad-month"><option value="">Please select</option>${Array.from({ length: 12 }, (_, i) => `<option>${i + 1}</option>`).join('')}</select>
  </body></html>`

  it('a full date answer lands as year and month in split selects, verified', () => {
    const doc = new JSDOM(PAGE).window.document
    const suggestions: FieldSuggestion[] = [
      { selector: '#grad-year', canonical: 'graduation_date', label: 'Graduation year', value: '2026-06-30', do_not_fill: false },
      { selector: '#grad-month', canonical: 'graduation_date', label: 'Graduation month', value: '2026-06-30', do_not_fill: false },
    ]
    const outcomes = applyFillToDocument(doc, suggestions)
    expect(outcomes.map((o) => o.status)).toEqual(['filled', 'filled'])
    expect((doc.querySelector('#grad-year') as HTMLSelectElement).selectedOptions[0].textContent).toBe('2026')
    expect((doc.querySelector('#grad-month') as HTMLSelectElement).selectedOptions[0].textContent).toBe('6')
    expect(verifyFill(doc, suggestions).every((v) => v.ok)).toBe(true)
  })

  it('"Jun 2026" style answers work too', () => {
    const doc = new JSDOM(PAGE).window.document
    const suggestions: FieldSuggestion[] = [
      { selector: '#grad-year', canonical: 'graduation_date', label: 'y', value: 'Jun 2026', do_not_fill: false },
      { selector: '#grad-month', canonical: 'graduation_date', label: 'm', value: 'Jun 2026', do_not_fill: false },
    ]
    const outcomes = applyFillToDocument(doc, suggestions)
    expect(outcomes.map((o) => o.status)).toEqual(['filled', 'filled'])
    expect((doc.querySelector('#grad-month') as HTMLSelectElement).selectedOptions[0].textContent).toBe('6')
  })
})

describe('the real PwC apply page (fresh-load full capture, 2026-08-12)', () => {
  const PAGE = fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/forms/pwc-apply.html'), 'utf8')
  const discover = () => discoverFields(new JSDOM(PAGE).window.document)

  it('classifies every answerable question on the page', () => {
    const all = discover()
    const byLabel = (frag: string) => all.find((f) => f.label.toLowerCase().includes(frag.toLowerCase()))
    const CASES: [string, string][] = [
      ['which programme you are interested in', 'programme_interest'],
      ['willing to consider other opportunities', 'open_to_other_opportunities'],
      ['require work authorisation or visa', 'visa_sponsorship_required'],
      ['family name in chinese', 'family_name_chinese'],
      ['given name in chinese', 'given_name_chinese'],
      ['family name in english', 'last_name'],
      ['given name in english', 'first_name'],
      ['preferred english name', 'preferred_name'],
      ['country/region (citizenship)', 'citizenship'],
      ['citizenship status', 'citizenship_status'],
      ['country/region of birth', 'country_of_birth'],
      ['current country/region', 'location'],
      ['country/region of school', 'school_country'],
      ['school or university', 'education_institution'],
      ['categories does your degree fall', 'degree'],
      ['major', 'major'],
      ['what is your major type', 'major_type'],
      ['academic ranking', 'academic_ranking'],
      ['department', 'department'],
      ['responsibilities', 'responsibilities'],
      ['employee type', 'employee_type'],
      ['mandarin proficiency', 'mandarin_proficiency'],
      ['cantonese proficiency', 'cantonese_proficiency'],
      ['english proficiency', 'english_proficiency'],
      ['public english examination', 'english_exam'],
      ['other language(s)', 'languages'],
      ['skill', 'skills'],
      ['professional qualification', 'professional_qualification'],
      ['labour dispute', 'legal_declarations'],
      ['related to a pwc partner', 'related_to_employee'],
      ['employed by pwc china', 'previously_employed_here'],
      ['which channel did you learn', 'referral_source'],
      ['job title', 'current_title'],
      ['company', 'current_company'],
    ]
    for (const [frag, expected] of CASES) {
      const f = byLabel(frag)
      expect(f, `field found: ${frag}`).toBeDefined()
      expect(classifyFieldDeterministic(f!), frag).toBe(expected)
    }
    // PwC's primary name field is labeled just "Name"
    const name = all.find((f) => f.label.trim() === 'Name')
    expect(name).toBeDefined()
    expect(classifyFieldDeterministic(name!)).toBe('full_name')
  })

  it('the split Mobile widget classifies as code select + local-number input', () => {
    const all = discover()
    const codeSelects = all.filter((f) => classifyFieldDeterministic(f) === 'phone_country_code')
    // primary Mobile code + Secondary contact number code
    expect(codeSelects).toHaveLength(2)
    expect(codeSelects.every((f) => f.is_combobox)).toBe(true)
    const number = all.find((f) => f.placeholder === 'Enter mobile number')
    expect(number).toBeDefined()
    expect(classifyFieldDeterministic(number!)).toBe('phone')
  })

  it('split-phone answers route end-to-end on the real widgets', async () => {
    saveProfile(
      sqlite,
      MasterProfileSchema.parse(
        JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/generation/profile.json'), 'utf8')),
      ),
    )
    const all = discover()
    const code = all.find((f) => f.is_combobox && classifyFieldDeterministic(f) === 'phone_country_code' && !f.label.includes('Secondary'))!
    const number = all.find((f) => f.placeholder === 'Enter mobile number')!
    const suggestions = await suggestForFields(sqlite, [code, number], null)
    const by = (sel: string) => suggestions.find((s) => s.selector === sel)!
    expect(by(code.selector).value).toBe('+852')
    expect(by(number.selector).value).toBe('44924625')
  })

  it('never guesses where it should stay silent', () => {
    const all = discover()
    // "Referral code" is an invite code — the referral_source rule must not
    // type "LinkedIn" into it
    const referralCode = all.find((f) => f.label.trim() === 'Referral code')
    expect(referralCode).toBeDefined()
    expect(classifyFieldDeterministic(referralCode!)).toBe('UNKNOWN')
    // Gender stays hard-blocked
    const gender = all.find((f) => f.label.trim() === 'Gender')
    expect(gender).toBeDefined()
    expect(classifyFieldDeterministic(gender!)).toBe('SENSITIVE_DO_NOT_FILL')
    // date-part selects of education/work periods must not catch the
    // expected-start-date rule ("Start and End Date" ≠ start date)
    expect(all.filter((f) => classifyFieldDeterministic(f) === 'expected_start_date')).toHaveLength(0)
    // every checkbox (instructions, Present, accuracy, consents) stays UNKNOWN
    const checkboxes = all.filter((f) => f.input_type === 'checkbox')
    expect(checkboxes.length).toBeGreaterThanOrEqual(5)
    expect(checkboxes.every((f) => classifyFieldDeterministic(f) === 'UNKNOWN')).toBe(true)
  })

  it('period year/month selects classify via synthesized range labels and fill from profile dates', async () => {
    const all = discover()
    const byLabel = (frag: string) => all.filter((f) => f.label.toLowerCase().includes(frag.toLowerCase()))
    const eduParts = byLabel('education period —')
    expect(eduParts.map((f) => classifyFieldDeterministic(f)).sort()).toEqual([
      'education_period_end',
      'education_period_end',
      'education_period_start',
      'education_period_start',
    ])
    const workParts = byLabel('start and end date —')
    expect(workParts.map((f) => classifyFieldDeterministic(f)).sort()).toEqual([
      'work_period_end',
      'work_period_end',
      'work_period_start',
      'work_period_start',
    ])

    saveProfile(
      sqlite,
      MasterProfileSchema.parse(
        JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/generation/profile.json'), 'utf8')),
      ),
    )
    const suggestions = await suggestForFields(sqlite, [...eduParts, ...workParts], null)
    const eduStart = suggestions.find((s) => s.canonical === 'education_period_start')!
    const eduEnd = suggestions.find((s) => s.canonical === 'education_period_end')!
    // full dates go out; year/month selects extract their part at fill time
    expect(eduStart.value).toBe('Sep 2022')
    expect(eduEnd.value).toBe('Jun 2026')
    expect(suggestions.every((s) => s.value)).toBe(true)
  })

  it('readonly calendar pickers (DOB, graduation date) are not treated as fillable fields', () => {
    const all = discover()
    expect(all.some((f) => f.label.includes('Date of Birth'))).toBe(false)
    expect(all.some((f) => f.label.includes('certificates of graduation'))).toBe(false)
  })

  it('fresh-load MokaHR menus are lazily rendered — comboboxes honestly carry zero options', () => {
    const all = discover()
    const combos = all.filter((f) => f.is_combobox)
    expect(combos.length).toBeGreaterThanOrEqual(20)
    expect(combos.every((f) => f.options.length === 0)).toBe(true)
    // maxlength="-1" must not become a 1-char-truncating cap
    expect(combos.every((f) => f.maxlength === null)).toBe(true)
  })
})

describe('harvested answer vocabularies (scans feed the answers-page dropdowns)', () => {
  let app: FastifyInstance

  beforeEach(() => {
    app = buildServer({ sqlite })
  })

  const post = (fields: unknown[], page_host = 'apply.mokahr.com') =>
    app.inject({ method: 'POST', url: '/api/autofill', headers: AUTH, payload: { fields, job_id: null, page_host } })

  const vocab = async () => {
    const res = await app.inject({ method: 'GET', url: '/api/answers/vocab', headers: AUTH })
    expect(res.statusCode).toBe(200)
    return (res.json() as { vocab: Record<string, { options: string[]; source_host: string }> }).vocab
  }

  it('stores real choices for answerable canonicals; placeholder rows, sensitive and option-less fields never land', async () => {
    const res = await post([
      mk('Academic Ranking', { selector: '#rank', tag: 'select', options: ['Please select', 'Top 10%', 'Top 25%', 'Top 50%', 'Below 50%'] }),
      mk('Gender', { selector: '#gender', tag: 'select', options: ['Please select', 'Male', 'Female'] }),
      mk('Family Name in English (e.g., Han)', { selector: '#family' }),
    ])
    expect(res.statusCode).toBe(200)
    // the panel surfaces this so the user can SEE the harvest happen
    expect((res.json() as { vocab_captured: number }).vocab_captured).toBe(1)
    const v = await vocab()
    expect(Object.keys(v)).toEqual(['academic_ranking'])
    expect(v.academic_ranking.options).toEqual(['Top 10%', 'Top 25%', 'Top 50%', 'Below 50%'])
    expect(v.academic_ranking.source_host).toBe('apply.mokahr.com')
  })

  it('POST /api/autofill/options stores fill-time harvested menus (lazy-render path)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/autofill/options',
      headers: AUTH,
      payload: {
        page_host: 'apply.mokahr.com',
        entries: [
          { canonical_field: 'citizenship_status', options: ['Please select', 'HK Permanent Resident', 'HK Resident (visa)', 'Non-resident'] },
          { canonical_field: 'SENSITIVE_DO_NOT_FILL', options: ['Male', 'Female'] },
          { canonical_field: 'not_a_canonical', options: ['a', 'b'] },
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { stored: number }).stored).toBe(1)
    const v = await vocab()
    expect(v.citizenship_status.options).toEqual(['HK Permanent Resident', 'HK Resident (visa)', 'Non-resident'])
    expect(v.SENSITIVE_DO_NOT_FILL).toBeUndefined()
  })

  it('rejects a malformed options payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/autofill/options',
      headers: AUTH,
      payload: { entries: [] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('scanning our own app never harvests our own UI (self-scan guard + sentinel strip)', async () => {
    // the live incident: the answers page's own selects became the
    // "captured choices" for their own questions
    for (const host of ['localhost:5180', '127.0.0.1:5180', 'hireyou-apply.vercel.app']) {
      const scanRes = await post(
        [mk('Academic Ranking', { selector: '#rank', tag: 'select', options: ['— not answered —', 'Top 10%', 'Custom answer…'] })],
        host,
      )
      expect((scanRes.json() as { vocab_captured: number }).vocab_captured, host).toBe(0)
      const optRes = await app.inject({
        method: 'POST',
        url: '/api/autofill/options',
        headers: AUTH,
        payload: { page_host: host, entries: [{ canonical_field: 'skills', options: ['Python', 'Java'] }] },
      })
      expect((optRes.json() as { stored: number }).stored, host).toBe(0)
    }
    expect(await vocab()).toEqual({})
    // and even from a real form, our sentinel strings are never real options
    await post([mk('Academic Ranking', { selector: '#rank', tag: 'select', options: ['— not answered —', 'Top 10%', 'Top 25%', 'Custom answer…'] })])
    const v = await vocab()
    expect(v.academic_ranking.options).toEqual(['Top 10%', 'Top 25%'])
  })

  it('the captured MokaHR widget feeds the vocab end-to-end (scan → harvest → answers page)', async () => {
    const fields = discoverFields(new JSDOM(WIDGET).window.document)
    const res = await post(fields)
    expect(res.statusCode).toBe(200)
    const v = await vocab()
    expect(v.previously_employed_here.options).toEqual(['Yes', 'No'])
  })

  it('latest scan wins per canonical', async () => {
    await post([mk('English proficiency', { selector: '#en', tag: 'select', options: ['Basic', 'Intermediate', 'Fluent'] })], 'a.example.com')
    await post(
      [mk('English proficiency', { selector: '#en', tag: 'select', options: ['Elementary', 'Limited working', 'Professional working', 'Native or bilingual'] })],
      'b.example.com',
    )
    const v = await vocab()
    expect(v.english_proficiency.options).toEqual(['Elementary', 'Limited working', 'Professional working', 'Native or bilingual'])
    expect(v.english_proficiency.source_host).toBe('b.example.com')
  })

  it('no_cache bypasses a stale cached classification (pre-fix maps must not outlive the fix)', async () => {
    const field = mk('Academic Ranking', { selector: '#rank', tag: 'select', options: ['Top 10%', 'Top 25%'] })
    // poison the cache the way a pre-fix scan would have: same fingerprint,
    // wrong canonical
    const { formFingerprint } = await import('../src/services/autofill')
    sqlite
      .prepare(`INSERT INTO autofill_form_cache (form_fingerprint, classifications_json, created_at) VALUES (?, ?, ?)`)
      .run(formFingerprint([field]), JSON.stringify({ '#rank': 'phone' }), new Date().toISOString())

    const cachedRes = await post([field])
    expect((cachedRes.json() as { suggestions: FieldSuggestion[] }).suggestions[0].canonical).toBe('phone')

    const freshRes = await app.inject({
      method: 'POST',
      url: '/api/autofill',
      headers: AUTH,
      payload: { fields: [field], job_id: null, no_cache: true },
    })
    expect((freshRes.json() as { suggestions: FieldSuggestion[] }).suggestions[0].canonical).toBe('academic_ranking')

    // the fresh result overwrote the poisoned entry — the next plain scan heals
    const healedRes = await post([field])
    expect((healedRes.json() as { suggestions: FieldSuggestion[] }).suggestions[0].canonical).toBe('academic_ranking')
  })

  it('DELETE /api/autofill/cache wipes every cached map', async () => {
    sqlite
      .prepare(`INSERT INTO autofill_form_cache (form_fingerprint, classifications_json, created_at) VALUES (?, ?, ?)`)
      .run('ff', JSON.stringify({ '#x': 'email' }), new Date().toISOString())
    const res = await app.inject({ method: 'DELETE', url: '/api/autofill/cache', headers: AUTH })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { cleared: number }).cleared).toBe(1)
    expect((sqlite.prepare(`SELECT count(*) n FROM autofill_form_cache`).get() as { n: number }).n).toBe(0)
  })

  it('binary answer questions carry static Yes/No choices for the answers page', () => {
    const binary = ANSWER_QUESTIONS.filter((q) => q.options)
    expect(binary.map((q) => q.key).sort()).toEqual([
      'legal_declarations',
      'open_to_other_opportunities',
      'previously_employed_here',
      'related_to_employee',
      'visa_sponsorship_required',
      'willing_to_relocate',
      'work_authorization',
    ])
    expect(binary.every((q) => q.options!.join('|') === 'Yes|No')).toBe(true)
  })
})
