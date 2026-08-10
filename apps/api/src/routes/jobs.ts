import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { JobInputSchema, JobPatchSchema, type JobInput } from '@app/shared'
import { createJob, dedupKey, deleteJob, getJob, listJobs, patchJob } from '../services/jobs'

export function registerJobRoutes(app: FastifyInstance, sqlite: Database.Database): void {
  app.post('/api/jobs', async (req, reply) => {
    const parsed = JobInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'validation_failed',
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      })
    }
    const { job, deduped } = createJob(sqlite, parsed.data)
    return reply.code(deduped ? 200 : 201).send({ job, deduped })
  })

  app.get('/api/jobs', async () => ({ jobs: listJobs(sqlite) }))

  // Saved-state lookup for the extension: is this posting already tracked?
  app.get('/api/jobs/match', async (req) => {
    const q = req.query as { board?: string; company?: string; title?: string }
    if (!q.company || !q.title) return { job: null }
    const key = dedupKey({
      source_board: (q.board ?? 'manual') as JobInput['source_board'],
      company: q.company,
      title: q.title,
    })
    const row = sqlite.prepare(`SELECT id FROM jobs WHERE dedup_key = ?`).get(key) as { id: string } | undefined
    return { job: row ? getJob(sqlite, row.id) : null }
  })

  app.get('/api/jobs/:id', async (req, reply) => {
    const job = getJob(sqlite, (req.params as { id: string }).id)
    if (!job) return reply.code(404).send({ error: 'not_found' })
    return job
  })

  app.patch('/api/jobs/:id', async (req, reply) => {
    const parsed = JobPatchSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'validation_failed',
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      })
    }
    const job = patchJob(sqlite, (req.params as { id: string }).id, parsed.data)
    if (!job) return reply.code(404).send({ error: 'not_found' })
    return job
  })

  app.delete('/api/jobs/:id', async (req, reply) => {
    const ok = deleteJob(sqlite, (req.params as { id: string }).id)
    if (!ok) return reply.code(404).send({ error: 'not_found' })
    return { deleted: true }
  })
}
