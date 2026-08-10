import Fastify, { type FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import type Database from 'better-sqlite3'
import { registerGenerationRoutes } from './routes/generation'
import { registerJobRoutes } from './routes/jobs'
import { registerProfileRoutes } from './routes/profile'
import { Runner } from './services/runs'

export interface ServerDeps {
  sqlite: Database.Database
}

declare module 'fastify' {
  interface FastifyInstance {
    runner: Runner
  }
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false })
  app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024, files: 1 } })
  const runner = new Runner(deps.sqlite)
  app.decorate('runner', runner)

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
  registerJobRoutes(app, deps.sqlite)
  registerGenerationRoutes(app, deps.sqlite, runner)

  return app
}
