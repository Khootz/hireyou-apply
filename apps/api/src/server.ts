import Fastify, { type FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { registerProfileRoutes } from './routes/profile'

export interface ServerDeps {
  sqlite: Database.Database
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false })

  app.addHook('onRequest', async (req, reply) => {
    const expected = process.env.API_AUTH_TOKEN
    if (!expected) {
      return reply.code(500).send({ error: 'API_AUTH_TOKEN not configured' })
    }
    if (req.headers.authorization !== `Bearer ${expected}`) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
  })

  app.get('/health', async () => ({ status: 'ok', service: 'hireyou-apply-api' }))

  registerProfileRoutes(app, deps.sqlite)

  return app
}
