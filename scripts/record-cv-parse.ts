// Records the cv-parse-thien-zhi LLM fixture from a live DeepSeek call.
// Run: npx tsx scripts/record-cv-parse.ts   (costs ~a fraction of a cent)
import 'dotenv/config'
import fs from 'node:fs'
import { parseCv } from '../apps/api/src/services/cvParse'

async function main() {
  process.env.LLM_MODE = 'record'
  const data = new Uint8Array(fs.readFileSync('tests/fixtures/cv/thien-zhi-cv.pdf'))
  const result = await parseCv(data, 'cv-parse')
  console.log('pages:', result.pages, '| warnings:', result.warnings)
  console.log('contact:', JSON.stringify(result.draft.contact))
  console.log('sections:', result.draft.sections.map((s) => `${s.type}:${s.title}`).join(' | '))
  for (const s of result.draft.sections) {
    if (s.type === 'experience')
      console.log(
        `  [${s.title}]`,
        s.content.entries.map((e) => `${e.organisation} | ${e.role} | ${e.start_date}->${e.end_date} (${e.bullets.length}b)`).join('; '),
      )
  }
}
main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
