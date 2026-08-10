// Live SMTP send test (M7 exit criterion): real Gmail send through the SOCKS
// proxy, SAFE_MODE recipient override, two real PDF attachments.
// Generation replays recorded fixtures (no LLM cost); the send is REAL.
// Run: npx tsx scripts/live-send-test.ts
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { MasterProfileSchema } from '@app/shared'
import { openDb } from '../apps/api/src/db'
import { generateCoverLetter, generateTailoredResume } from '../apps/api/src/services/generation'
import { createJob } from '../apps/api/src/services/jobs'
import { buildEmailDraft, sendApplicationEmail } from '../apps/api/src/services/mailer'
import { closePdfBrowser } from '../apps/api/src/services/pdf'
import { saveProfile } from '../apps/api/src/services/profile'
import { insertDocument } from '../apps/api/src/services/runs'

async function main() {
  process.env.LLM_MODE = 'replay'
  const { sqlite } = openDb(':memory:')

  const profile = MasterProfileSchema.parse(
    JSON.parse(fs.readFileSync(path.resolve('tests/fixtures/generation/profile.json'), 'utf8')),
  )
  saveProfile(sqlite, profile)

  const { job } = createJob(sqlite, {
    title: 'Quant Researcher Intern',
    company: 'Jain Global',
    location: 'Hong Kong',
    source_url: 'https://career.hkust.edu.hk/web/job_detail.php?jp=86585',
    source_board: 'hkust',
    jd_text: fs.readFileSync(path.resolve('tests/fixtures/generation/jain-jd.txt'), 'utf8'),
    apply_email: 'APAC-Careers@jainglobal.com',
    deadline: '2026-09-30',
    status: 'saved',
    notes: '',
  })

  console.log('generating documents from fixtures...')
  const resume = insertDocument(sqlite, job.id, 'resume', await generateTailoredResume(profile, job))
  const cover = insertDocument(sqlite, job.id, 'cover_letter', await generateCoverLetter(profile, job))

  const draft = buildEmailDraft(sqlite, job)
  console.log(`safe_mode: ${draft.safe_mode} | intended: ${draft.to_intended} | actual: ${draft.to_actual}`)
  console.log('sending via Gmail SMTP through the SOCKS proxy...')

  const record = await sendApplicationEmail(sqlite, {
    job,
    to_intended: draft.to_intended,
    subject: draft.subject,
    body: draft.body,
    attachment_doc_ids: [resume.id, cover.id],
  })
  console.log('✅ SENT')
  console.log(`   to_actual:   ${record.to_actual}`)
  console.log(`   to_intended: ${record.to_intended} (never contacted — SAFE_MODE)`)
  console.log(`   subject:     ${record.subject}`)
  console.log(`   attachments: ${record.attachment_doc_ids.length} PDFs`)
  await closePdfBrowser()
}

main()
  .catch(async (e) => {
    console.error('❌ SEND FAILED:', e.message)
    await closePdfBrowser()
    process.exit(1)
  })
