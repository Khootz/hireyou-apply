import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { FieldInfoSchema } from '@app/shared/autofill'
import { suggestForFields } from '../services/autofill'
import { getJob } from '../services/jobs'

const BodySchema = z.object({
  fields: z.array(FieldInfoSchema).min(1).max(100),
  job_id: z.string().nullable().default(null),
})

export function registerAutofillRoutes(app: FastifyInstance, sqlite: Database.Database): void {
  app.post('/api/autofill', async (req, reply) => {
    const parsed = BodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'validation_failed',
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      })
    }
    const job = parsed.data.job_id ? getJob(sqlite, parsed.data.job_id) : null
    const suggestions = await suggestForFields(sqlite, parsed.data.fields, job)
    return { suggestions }
  })
}
