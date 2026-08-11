import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import type Database from 'better-sqlite3'
import { registerAnswerRoutes } from './routes/answers'
import { registerAutofillRoutes } from './routes/autofill'
import { registerDocumentRoutes } from './routes/documents'
import { registerEmailRoutes, type EmailRouteDeps } from './routes/email'
import { registerGenerationRoutes } from './routes/generation'
import { registerJobRoutes } from './routes/jobs'
import { registerProfileRoutes } from './routes/profile'
import { recordKeySightings, rotationReminders } from './services/keyRotation'
import { Runner } from './services/runs'

export interface ServerDeps {
  sqlite: Database.Database
  email?: EmailRouteDeps
}

declare module 'fastify' {
  interface FastifyInstance {
    runner: Runner
  }
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false })
  // The extension calls from a chrome-extension:// origin; single-user local
  // API, auth is the bearer token, so reflect any origin.
  app.register(cors, { origin: true, methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'] })
  // Chrome's Private Network Access: a public page (the Vercel-hosted UI)
  // calling 127.0.0.1 needs this header on the preflight response.
  app.addHook('onSend', async (req, reply) => {
    if (req.headers['access-control-request-private-network'] === 'true') {
      reply.header('access-control-allow-private-network', 'true')
    }
  })
  app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024, files: 1 } })
  const runner = new Runner(deps.sqlite)
  app.decorate('runner', runner)

  app.addHook('onRequest', async (req, reply) => {
    // CORS preflights carry no Authorization header by design — they must
    // reach the cors plugin, not die here.
    if (req.method === 'OPTIONS') return
    const expected = process.env.API_AUTH_TOKEN
    if (!expected) {
      return reply.code(500).send({ error: 'API_AUTH_TOKEN not configured' })
    }
    // iframes/new tabs can't set headers, so PDF GETs may authenticate via
    // ?token= (single-user local app; the token equals the bearer token).
    const queryToken = (req.query as Record<string, unknown>)?.token
    if (req.headers.authorization === `Bearer ${expected}`) return
    if (typeof queryToken === 'string' && queryToken === expected && req.method === 'GET') return
    return reply.code(401).send({ error: 'unauthorized' })
  })

  recordKeySightings(deps.sqlite)

  app.get('/health', async () => ({
    status: 'ok',
    service: 'hireyou-apply-api',
    key_rotation_due: rotationReminders(deps.sqlite),
  }))

  registerProfileRoutes(app, deps.sqlite)
  registerJobRoutes(app, deps.sqlite)
  registerGenerationRoutes(app, deps.sqlite, runner)
  registerDocumentRoutes(app, deps.sqlite)
  registerEmailRoutes(app, deps.sqlite, deps.email)
  registerAutofillRoutes(app, deps.sqlite)
  registerAnswerRoutes(app, deps.sqlite)

  return app
}
