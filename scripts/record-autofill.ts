// Records the autofill classify + answers fixtures from live DeepSeek calls
// against the fixture apply form and the frozen test profile.
// Run: npx tsx scripts/record-autofill.ts
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import { MasterProfileSchema, type JobRecord } from '@app/shared'
import { discoverFields } from '@app/shared/autofill'
import { openDb } from '../apps/api/src/db'
import { saveProfile } from '../apps/api/src/services/profile'
import { suggestForFields } from '../apps/api/src/services/autofill'

async function main() {
  process.env.LLM_MODE = 'record'
  const html = fs.readFileSync('tests/fixtures/forms/apply-form.html', 'utf8')
  const doc = new JSDOM(html).window.document
  const fields = discoverFields(doc)
  console.log(`discovered ${fields.length} fields:`)
  for (const f of fields) console.log(` - [${f.tag}/${f.input_type}] "${f.label}"`)

  const { sqlite } = openDb(':memory:')
  const profile = MasterProfileSchema.parse(
    JSON.parse(fs.readFileSync(path.resolve('tests/fixtures/generation/profile.json'), 'utf8')),
  )
  saveProfile(sqlite, profile)

  const job: JobRecord = {
    id: 'job-x',
    title: 'Software Engineer',
    company: 'Acme HK',
    location: 'Hong Kong',
    source_url: '',
    source_board: 'manual',
    jd_text: 'We are hiring a software engineer in Hong Kong. Python, TypeScript, cloud. Fresh graduates welcome.',
    apply_email: null,
    deadline: '',
    status: 'saved',
    notes: '',
    saved_at: '',
    applied_at: null,
    status_updated_at: '',
  }

  const suggestions = await suggestForFields(sqlite, fields, job)
  for (const s of suggestions) {
    console.log(
      `${s.do_not_fill ? '🚫' : s.value ? '✓ ' : '· '} ${s.canonical.padEnd(24)} "${s.label.slice(0, 30)}" -> ${s.value ? s.value.slice(0, 60) : s.note ?? '(none)'}`,
    )
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
