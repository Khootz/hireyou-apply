import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { renderDocumentPdf, storageDir } from '../services/pdf'
import { getDocument } from '../services/runs'

export function registerDocumentRoutes(app: FastifyInstance, sqlite: Database.Database): void {
  // Renders (or re-serves) the document's PDF. Rendering is on demand and
  // cached by (document id, version) — content is immutable per version.
  app.get('/api/documents/:id/pdf', async (req, reply) => {
    const doc = getDocument(sqlite, (req.params as { id: string }).id)
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    const file = path.join(storageDir(), `${doc.id}-v${doc.version}.pdf`)
    if (!fs.existsSync(file)) {
      const pdf = await renderDocumentPdf(doc.content)
      fs.writeFileSync(file, pdf)
      sqlite.prepare(`UPDATE documents SET pdf_path = ? WHERE id = ?`).run(file, doc.id)
    }
    const filename = `${doc.type === 'resume' ? 'Resume' : 'Cover Letter'} v${doc.version}.pdf`
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="${filename}"`)
      .send(fs.createReadStream(file))
  })
}
