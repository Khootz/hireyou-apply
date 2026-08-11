import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { getAnswers, saveAnswers } from '../services/answers'

const BodySchema = z.object({ answers: z.record(z.string(), z.string()) })

export function registerAnswerRoutes(app: FastifyInstance, sqlite: Database.Database): void {
  app.get('/api/answers', async () => ({ answers: getAnswers(sqlite) }))

  app.put('/api/answers', async (req, reply) => {
    const parsed = BodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_failed' })
    }
    return { answers: saveAnswers(sqlite, parsed.data.answers) }
  })
}
