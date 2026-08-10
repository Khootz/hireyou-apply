// Records tailor-resume + cover-letter LLM fixtures from live DeepSeek calls,
// pinning a stable test profile (frozen fact_ids) and the real Jain Global JD
// extracted from the HKUST fixture page.
// Run: npx tsx scripts/record-generation.ts   (two strong-model calls, ~1-2 cents)
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import { MasterProfileSchema, type JobRecord } from '@app/shared'
import { generateCoverLetter, generateTailoredResume } from '../apps/api/src/services/generation'
import { normalizeProfile } from '../apps/api/src/services/profile'

const GEN_DIR = path.resolve('tests/fixtures/generation')

async function main() {
  fs.mkdirSync(GEN_DIR, { recursive: true })

  // Stable profile: the recorded cv-parse fixture, normalized ONCE, frozen to disk.
  const profilePath = path.join(GEN_DIR, 'profile.json')
  if (!fs.existsSync(profilePath)) {
    const cvFixture = JSON.parse(fs.readFileSync('tests/fixtures/llm/cv-parse.json', 'utf8')) as { content: string }
    const draft = MasterProfileSchema.parse(JSON.parse(cvFixture.content))
    fs.writeFileSync(profilePath, JSON.stringify(normalizeProfile(draft), null, 2))
    console.log('wrote frozen profile.json')
  }
  const profile = MasterProfileSchema.parse(JSON.parse(fs.readFileSync(profilePath, 'utf8')))

  // Real JD from the captured HKUST detail page.
  const jdPath = path.join(GEN_DIR, 'jain-jd.txt')
  if (!fs.existsSync(jdPath)) {
    const html = fs.readFileSync('tests/fixtures/hkust/detail-86585.html', 'utf8')
    const doc = new JSDOM(html).window.document
    const scope = doc.querySelector('.career-content') ?? doc.body
    const text = (scope.textContent ?? '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, 4000)
    fs.writeFileSync(jdPath, text)
    console.log('wrote jain-jd.txt,', text.length, 'chars')
  }
  const jd = fs.readFileSync(jdPath, 'utf8')

  const job: JobRecord = {
    id: 'job-jain',
    title: 'Quant Researcher Intern',
    company: 'Jain Global',
    location: 'Hong Kong',
    source_url: 'https://career.hkust.edu.hk/web/job_detail.php?jp=86585',
    source_board: 'hkust',
    jd_text: jd,
    apply_email: 'APAC-Careers@jainglobal.com',
    deadline: '',
    status: 'saved',
    notes: '',
    saved_at: new Date().toISOString(),
    applied_at: null,
    status_updated_at: new Date().toISOString(),
  }

  process.env.LLM_MODE = 'record'

  console.log('\n--- recording tailor-resume ---')
  const resume = await generateTailoredResume(profile, job)
  console.log('sections:', resume.sections.map((s) => s.title).join(' | '))
  const bulletCount = resume.sections.reduce(
    (n, s) => n + (s.type === 'experience' ? s.entries.reduce((m, e) => m + e.bullets.length, 0) : s.type === 'bullets' ? s.items.length : 0),
    0,
  )
  console.log('total bullets:', bulletCount)

  console.log('\n--- recording cover-letter ---')
  const letter = await generateCoverLetter(profile, job)
  console.log('p1:', letter.paragraphs[0].slice(0, 160), '...')
  console.log('lengths:', letter.paragraphs.map((p) => p.length).join(', '))
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
