import { MasterProfileSchema, type MasterProfile } from '@app/shared'
import { chatJSON } from '../llm/client'
import { extractPdfText } from './cvExtract'

export interface CvParseResult {
  draft: MasterProfile
  pages: number
  warnings: string[]
}

const SYSTEM = `You convert raw resume text into a structured profile. Rules:
- NEVER invent, embellish, or omit content. Preserve the author's wording verbatim except for whitespace repair.
- Every piece of resume content must land in exactly one section.
- Section types: "paragraph" (prose like a summary or a single-value line such as a website), "experience" (anything with organisation/role/dates: jobs, education, awards, activities), "bullets" (flat lists like skills or interests).
- For experience entries: organisation, role, start_date, end_date, location as written; is_current true only if explicitly ongoing. Each achievement line becomes one bullet.
- contact: full_name, email, phone, location. Use empty string when absent.
- Leave every "id" and "fact_id" as "".
Return JSON: {"contact": {...}, "sections": [{"id":"","order":<int>,"title":"...","type":"...","content":{...}}]}
content shapes: paragraph {"text":...} | experience {"entries":[{"fact_id":"","organisation":...,"role":...,"start_date":...,"end_date":...,"is_current":bool,"location":...,"bullets":[{"fact_id":"","text":...}]}]} | bullets {"items":[{"fact_id":"","text":...}]}`

export async function parseCv(data: Uint8Array, fixture = 'cv-parse'): Promise<CvParseResult> {
  const extracted = await extractPdfText(data)
  if (!extracted.text.trim()) {
    throw new Error('No machine-readable text found in this PDF (is it a scanned image?)')
  }

  const draft = await chatJSON({
    tier: 'cheap',
    system: SYSTEM,
    user: `Resume text (reading order reconstructed from PDF layout):\n\n${extracted.text}`,
    schema: MasterProfileSchema,
    fixture,
    temperature: 0.1,
  })

  return { draft, pages: extracted.pages, warnings: extracted.warnings }
}
