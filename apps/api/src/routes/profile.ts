import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { MasterProfileSchema, type MasterProfile, type ResumeDocument } from '@app/shared'
import { extractPdfText } from '../services/cvExtract'
import { parseCv } from '../services/cvParse'
import { renderDocumentPdf, storageDir } from '../services/pdf'
import { getProfile, saveProfile } from '../services/profile'

// The master profile previewed through the SAME renderer used for exports —
// what the editor shows IS the PDF (parity by construction, spec §7).
function profileToResumeDoc(profile: MasterProfile): ResumeDocument {
  return {
    kind: 'resume',
    contact: profile.contact,
    sections: profile.sections.map((s) => {
      if (s.type === 'paragraph') {
        return { type: 'paragraph' as const, title: s.title || ' ', source_section_id: s.id, text: s.content.text }
      }
      if (s.type === 'experience') {
        return {
          type: 'experience' as const,
          title: s.title || ' ',
          source_section_id: s.id,
          entries: s.content.entries
            .filter((e) => e.organisation || e.role || e.bullets.some((b) => b.text.trim()))
            .map((e) => ({
              source_fact_id: e.fact_id,
              organisation: e.organisation,
              role: e.role,
              start_date: e.start_date,
              end_date: e.end_date,
              is_current: e.is_current,
              location: e.location,
              bullets: e.bullets.filter((b) => b.text.trim()).map((b) => ({ source_fact_id: b.fact_id, text: b.text })),
            })),
        }
      }
      return {
        type: 'bullets' as const,
        title: s.title || ' ',
        source_section_id: s.id,
        items: s.content.items.filter((b) => b.text.trim()).map((b) => ({ source_fact_id: b.fact_id, text: b.text })),
      }
    }),
  }
}

async function profilePdfFile(sqlite: Database.Database): Promise<string> {
  const row = sqlite.prepare(`SELECT updated_at FROM master_profile WHERE id = 1`).get() as
    | { updated_at: string }
    | undefined
  const stamp = (row?.updated_at ?? 'empty').replace(/[:.]/g, '-')
  const file = path.join(storageDir(), `profile-${stamp}.pdf`)
  if (!fs.existsSync(file)) {
    const pdf = await renderDocumentPdf(profileToResumeDoc(getProfile(sqlite)))
    fs.writeFileSync(file, pdf)
  }
  return file
}

export function registerProfileRoutes(app: FastifyInstance, sqlite: Database.Database): void {
  app.get('/api/profile', async () => getProfile(sqlite))

  app.get('/api/profile/pdf', async (_req, reply) => {
    const file = await profilePdfFile(sqlite)
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', 'inline; filename="My Resume.pdf"')
      .send(fs.createReadStream(file))
  })

  app.get('/api/profile/pdf/meta', async () => {
    const file = await profilePdfFile(sqlite)
    const extracted = await extractPdfText(new Uint8Array(fs.readFileSync(file)))
    return { pages: extracted.pages }
  })

  // Parses an uploaded CV into a DRAFT profile for user review.
  // Deliberately does not persist anything: applying the draft is the
  // client's explicit follow-up PUT after the user confirms.
  app.post('/api/profile/parse-cv', async (req, reply) => {
    const file = await req.file()
    if (!file) {
      return reply.code(400).send({ error: 'no_file', message: 'Upload a PDF file' })
    }
    const buffer = await file.toBuffer()
    if (file.file.truncated) {
      return reply.code(400).send({ error: 'file_too_large', message: 'PDF must be 2 MB or smaller' })
    }
    const isPdf = buffer.subarray(0, 5).toString('latin1') === '%PDF-'
    if (!isPdf) {
      return reply.code(400).send({ error: 'not_a_pdf', message: 'Only PDF files are supported' })
    }
    try {
      return await parseCv(new Uint8Array(buffer))
    } catch (err) {
      return reply.code(422).send({ error: 'parse_failed', message: (err as Error).message })
    }
  })

  app.put('/api/profile', async (req, reply) => {
    const parsed = MasterProfileSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'validation_failed',
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      })
    }
    return saveProfile(sqlite, parsed.data)
  })
}
