import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { MasterProfileSchema } from '@app/shared'
import { getProfile, saveProfile } from '../services/profile'

export function registerProfileRoutes(app: FastifyInstance, sqlite: Database.Database): void {
  app.get('/api/profile', async () => getProfile(sqlite))

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
