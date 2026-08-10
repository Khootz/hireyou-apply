import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { MasterProfileSchema } from '@app/shared'
import { getProfile, saveProfile } from '../services/profile'
import { parseCv } from '../services/cvParse'

export function registerProfileRoutes(app: FastifyInstance, sqlite: Database.Database): void {
  app.get('/api/profile', async () => getProfile(sqlite))

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
