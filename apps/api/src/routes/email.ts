import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { getJob } from '../services/jobs'
import { buildEmailDraft, listEmails, sendApplicationEmail, type MailTransport } from '../services/mailer'

const SendBodySchema = z.object({
  to: z.string().email().optional(),
  subject: z.string().min(1),
  body: z.string().min(1),
  attachment_doc_ids: z.array(z.string()).min(1),
})

export interface EmailRouteDeps {
  // test seam: production uses the real SMTP transport
  transport?: MailTransport
}

export function registerEmailRoutes(app: FastifyInstance, sqlite: Database.Database, deps: EmailRouteDeps = {}): void {
  app.get('/api/jobs/:id/email/preview', async (req, reply) => {
    const job = getJob(sqlite, (req.params as { id: string }).id)
    if (!job) return reply.code(404).send({ error: 'not_found' })
    return buildEmailDraft(sqlite, job)
  })

  app.post('/api/jobs/:id/email/send', async (req, reply) => {
    const job = getJob(sqlite, (req.params as { id: string }).id)
    if (!job) return reply.code(404).send({ error: 'not_found' })
    const parsed = SendBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'validation_failed',
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      })
    }
    const toIntended = parsed.data.to ?? job.apply_email ?? ''
    if (!toIntended) {
      return reply.code(422).send({ error: 'no_recipient', message: 'This job has no apply email; provide one.' })
    }
    try {
      const record = await sendApplicationEmail(
        sqlite,
        {
          job,
          to_intended: toIntended,
          subject: parsed.data.subject,
          body: parsed.data.body,
          attachment_doc_ids: parsed.data.attachment_doc_ids,
        },
        deps.transport,
      )
      return { sent: true, record }
    } catch (err) {
      return reply.code(502).send({ error: 'send_failed', message: (err as Error).message })
    }
  })

  app.get('/api/jobs/:id/emails', async (req) => ({
    emails: listEmails(sqlite, (req.params as { id: string }).id),
  }))
}
