import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { JobInputSchema, JobPatchSchema } from '@app/shared'
import { createJob, deleteJob, getJob, listJobs, patchJob } from '../services/jobs'

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
