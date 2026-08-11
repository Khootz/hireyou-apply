import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { FieldInfoSchema, MAX_AUTOFILL_FIELDS } from '@app/shared/autofill'
import { formFingerprint, suggestForFields } from '../services/autofill'
import { getJob } from '../services/jobs'

const BodySchema = z.object({
  fields: z.array(FieldInfoSchema).min(1).max(MAX_AUTOFILL_FIELDS),
  job_id: z.string().nullable().default(null),
})

// Suggestion telemetry (M9): which canonical fields actually get used. The
// extension posts fire-and-forget; values are never sent — only the canonical
// name and what happened to the suggestion.
const EventsBodySchema = z.object({
  form_fingerprint: z.string().min(1).max(128),
  events: z
    .array(
      z.object({
        canonical_field: z.string().min(1).max(64),
        action: z.enum(['copied', 'dismissed', 'ignored']),
      }),
    )
    .min(1)
    .max(100),
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
    return { suggestions, form_fingerprint: formFingerprint(parsed.data.fields) }
  })

  app.post('/api/autofill/events', async (req, reply) => {
    const parsed = EventsBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'validation_failed',
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      })
    }
    const now = new Date().toISOString()
    const insert = sqlite.prepare(
      `INSERT INTO field_suggestion_events (id, form_fingerprint, canonical_field, action, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
    const tx = sqlite.transaction(() => {
      for (const e of parsed.data.events) {
        insert.run(randomUUID(), parsed.data.form_fingerprint, e.canonical_field, e.action, now)
      }
    })
    tx()
    return { recorded: parsed.data.events.length }
  })
}
