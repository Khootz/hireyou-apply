import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { getJob } from '../services/jobs'
import { getProfile } from '../services/profile'
import { createRun, findActiveRun, getDocument, getRun, listDocuments, type Runner } from '../services/runs'

const GenerateBodySchema = z.object({ type: z.enum(['resume', 'cover_letter']) })

export function registerGenerationRoutes(app: FastifyInstance, sqlite: Database.Database, runner: Runner): void {
  app.post('/api/jobs/:id/generate', async (req, reply) => {
    const parsed = GenerateBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues.map((i) => i.message) })
    }
    const job = getJob(sqlite, (req.params as { id: string }).id)
    if (!job) return reply.code(404).send({ error: 'not_found' })

    // Readiness gate — the draft-friendly profile gets strict exactly here.
    const profile = getProfile(sqlite)
    const problems: string[] = []
    if (!profile.contact.full_name.trim()) problems.push('profile is missing your full name')
    if (!profile.contact.email.trim()) problems.push('profile is missing your email')
    const entryCount = profile.sections
      .filter((s) => s.type === 'experience')
      .reduce((n, s) => (s.type === 'experience' ? n + s.content.entries.length : n), 0)
    if (entryCount === 0) problems.push('profile has no experience entries')
    if (!job.jd_text.trim()) problems.push('job has no job description')
    if (problems.length > 0) {
      return reply.code(422).send({ error: 'not_ready', problems })
    }

    const kind = parsed.data.type === 'resume' ? ('tailor_resume' as const) : ('cover_letter' as const)
    const active = findActiveRun(sqlite, job.id, kind)
    if (active) {
      return reply.code(200).send({ run: active, deduped: true })
    }
    const run = createRun(sqlite, job.id, kind)
    runner.enqueue(run.id)
    return reply.code(202).send({ run, deduped: false })
  })

  app.get('/api/runs/:id', async (req, reply) => {
    const run = getRun(sqlite, (req.params as { id: string }).id)
    if (!run) return reply.code(404).send({ error: 'not_found' })
    return run
  })

  app.get('/api/jobs/:id/documents', async (req) => ({
    documents: listDocuments(sqlite, (req.params as { id: string }).id),
  }))

  app.get('/api/documents/:id', async (req, reply) => {
    const doc = getDocument(sqlite, (req.params as { id: string }).id)
    if (!doc) return reply.code(404).send({ error: 'not_found' })
    return doc
  })
}
