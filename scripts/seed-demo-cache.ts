// Copies a job's newest resume + cover letter into demo_generation_cache so
// the runner replays them instead of calling the LLM — fast, deterministic
// stage demos. Generate both documents once for real first.
// Run: npx tsx scripts/seed-demo-cache.ts <job-id>
import 'dotenv/config'
import { openDb } from '../apps/api/src/db'

const jobId = process.argv[2]
if (!jobId) {
  console.error('usage: npx tsx scripts/seed-demo-cache.ts <job-id>')
  process.exit(1)
}

const { sqlite } = openDb()
const job = sqlite.prepare(`SELECT title, company FROM jobs WHERE id = ?`).get(jobId) as
  | { title: string; company: string }
  | undefined
if (!job) {
  console.error(`no job with id ${jobId}`)
  process.exit(1)
}
console.log(`seeding demo cache for: ${job.title} — ${job.company}`)

const KINDS = [
  { type: 'resume', kind: 'tailor_resume' },
  { type: 'cover_letter', kind: 'cover_letter' },
] as const

for (const { type, kind } of KINDS) {
  const doc = sqlite
    .prepare(`SELECT content_json, version FROM documents WHERE job_id = ? AND type = ? ORDER BY version DESC LIMIT 1`)
    .get(jobId, type) as { content_json: string; version: number } | undefined
  if (!doc) {
    console.error(`  ${type}: NO document found — generate one first, then re-run`)
    continue
  }
  sqlite
    .prepare(
      `INSERT INTO demo_generation_cache (job_id, kind, content_json, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (job_id, kind) DO UPDATE SET content_json = excluded.content_json, created_at = excluded.created_at`,
    )
    .run(jobId, kind, doc.content_json, new Date().toISOString())
  console.log(`  ${type}: cached from v${doc.version}`)
}
