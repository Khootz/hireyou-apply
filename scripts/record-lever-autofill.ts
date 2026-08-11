import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import { fetch as undiciFetch, ProxyAgent } from 'undici'
import { JobInputSchema, MasterProfileSchema } from '@app/shared'
import { discoverFields } from '@app/shared/autofill'
import { openDb } from '../apps/api/src/db'
import { suggestForFields } from '../apps/api/src/services/autofill'
import { saveProfile } from '../apps/api/src/services/profile'
import { saveAnswers } from '../apps/api/src/services/answers'
import { createJob } from '../apps/api/src/services/jobs'

// Re-record the Lever autofill LLM fixtures against the REAL Palantir form:
//   LLM_MODE=record npx tsx scripts/record-lever-autofill.ts
// Produces tests/fixtures/llm/lever-classify.json + lever-answers.json and
// tests/fixtures/generation/palantir-jd.txt (fetched live if missing).

const JD_PATH = path.resolve('tests/fixtures/generation/palantir-jd.txt')
const POSTING_URL = 'https://jobs.lever.co/palantir/ac978161-6f46-4f6b-ad9e-a258e642751c'

async function ensureJd(): Promise<string> {
  if (fs.existsSync(JD_PATH)) return fs.readFileSync(JD_PATH, 'utf8')
  const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY
  const res = await undiciFetch(POSTING_URL, {
    dispatcher: proxy ? new ProxyAgent(proxy) : undefined,
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0' },
  })
  const doc = new JSDOM(await res.text()).window.document
  const jd = (doc.querySelector('.posting-page, .content')?.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000)
  if (jd.length < 200) throw new Error(`JD extraction too short (${jd.length} chars) — check the posting URL`)
  fs.writeFileSync(JD_PATH, jd)
  return jd
}

async function main(): Promise<void> {
  const { sqlite } = openDb(':memory:')
  const profile = MasterProfileSchema.parse(
    JSON.parse(fs.readFileSync(path.resolve('tests/fixtures/generation/profile.json'), 'utf8')),
  )
  saveProfile(sqlite, profile)
  saveAnswers(sqlite, {
    linkedin_url: 'https://linkedin.com/in/thienzhi',
    github_url: 'https://github.com/thienzhi',
    portfolio_url: 'https://thienzhi.dev',
    work_authorization: 'Yes — Hong Kong resident, no work permit needed',
    visa_sponsorship_required: 'No',
    notice_period: 'Available immediately',
    expected_start_date: '1 June 2026',
    salary_expectation: 'HKD 25,000/month',
    current_salary: 'Prefer not to disclose',
    years_experience: '2',
    highest_education_level: "Bachelor's degree (in progress)",
    languages: 'English (fluent), Mandarin (native), Cantonese (conversational)',
    willing_to_relocate: 'Yes — open to relocating',
    referral_source: 'LinkedIn',
    name_pronunciation: 'TEEN-zhee KOO',
    proudest_accomplishment:
      'Built a production data pipeline during my internship that cut reporting latency from hours to minutes.',
  })
  const jd = await ensureJd()
  const { job } = createJob(
    sqlite,
    JobInputSchema.parse({
      title: 'Software Engineer Intern',
      company: 'Palantir',
      source_url: POSTING_URL,
      jd_text: jd,
    }),
  )

  const html = fs.readFileSync(path.resolve('tests/fixtures/forms/lever-apply.html'), 'utf8')
  const fields = discoverFields(new JSDOM(html).window.document)
  console.log(`discovered ${fields.length} fields; mode=${process.env.LLM_MODE ?? '(default)'}`)

  const suggestions = await suggestForFields(sqlite, fields, job, {
    classify: 'lever-classify',
    answers: 'lever-answers',
  })
  const withValue = suggestions.filter((s) => s.value)
  const blocked = suggestions.filter((s) => s.do_not_fill)
  const empty = suggestions.filter((s) => !s.value && !s.do_not_fill)
  console.log(`values: ${withValue.length} | blocked: ${blocked.length} | empty: ${empty.length}`)
  for (const s of suggestions) {
    const state = s.do_not_fill ? 'BLOCKED' : s.value ? 'FILL' : 'empty'
    console.log(`  [${state}] ${(s.label || s.canonical).slice(0, 60)} -> ${(s.value ?? s.note ?? '').slice(0, 70)}`)
  }
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
