import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import nodemailer from 'nodemailer'

const require = createRequire(import.meta.url)
import type Database from 'better-sqlite3'
import type { JobRecord } from '@app/shared'
import { getProfile } from './profile'
import { renderDocumentPdf, storageDir } from './pdf'
import { getDocument, listDocuments } from './runs'

// SAFE_MODE is the contract that lets the user demo real sending without
// applying anywhere: the recipient override lives INSIDE the send function,
// not at call sites, so no API payload can route mail to a real employer
// while SAFE_MODE is on. Defaults to ON — it must be explicitly disabled.

export interface EmailRecordRow {
  id: string
  job_id: string
  to_intended: string
  to_actual: string
  subject: string
  body: string
  attachment_doc_ids: string[]
  safe_mode: boolean
  sent_at: string
}

export interface EmailDraft {
  to_intended: string
  to_actual: string
  safe_mode: boolean
  subject: string
  body: string
  attachments: { document_id: string; type: string; version: number; filename: string }[]
  problems: string[]
}

export function safeModeOn(): boolean {
  // anything except an explicit "false" keeps the override active
  return (process.env.SAFE_MODE ?? 'true').toLowerCase() !== 'false'
}

export function resolveRecipient(intended: string): { to_actual: string; safe_mode: boolean } {
  if (safeModeOn()) {
    const override = process.env.SAFE_MODE_RECIPIENT
    if (!override) throw new Error('SAFE_MODE is on but SAFE_MODE_RECIPIENT is not set')
    return { to_actual: override, safe_mode: true }
  }
  return { to_actual: intended, safe_mode: false }
}

function latestDocs(sqlite: Database.Database, jobId: string) {
  const docs = listDocuments(sqlite, jobId)
  const latest = (type: string) => docs.filter((d) => d.type === type).sort((a, b) => b.version - a.version)[0]
  return { resume: latest('resume'), cover: latest('cover_letter') }
}

export function buildEmailDraft(sqlite: Database.Database, job: JobRecord): EmailDraft {
  const profile = getProfile(sqlite)
  const { resume, cover } = latestDocs(sqlite, job.id)
  const problems: string[] = []
  if (!job.apply_email) problems.push('this job has no apply email — enter a recipient manually')
  if (!resume) problems.push('no tailored resume generated yet')
  if (!cover) problems.push('no cover letter generated yet')

  const name = profile.contact.full_name || 'the applicant'
  // Body skeleton adapted from the user's proven 2025 application email.
  const body = `Dear ${job.company} Recruitment Team,

I am writing to apply for the ${job.title} position${job.source_board === 'hkust' ? ' advertised on the HKUST Career Center job board' : ''}.

Attached are my resume and cover letter tailored to this role. I would welcome the opportunity to discuss how I can contribute to your team, and I am readily available via email or phone for an interview.

Thank you for your consideration.

Best Regards,
${name}`

  const intended = job.apply_email ?? ''
  const { to_actual, safe_mode } = resolveRecipient(intended || '(none)')
  const attachments = [resume, cover]
    .filter((d): d is NonNullable<typeof resume> => Boolean(d))
    .map((d) => ({
      document_id: d.id,
      type: d.type,
      version: d.version,
      filename: d.type === 'resume' ? `${name} Resume.pdf` : `${name} Cover Letter.pdf`,
    }))

  return {
    to_intended: intended,
    to_actual,
    safe_mode,
    subject: `Application for ${job.title}`,
    body,
    attachments,
    problems,
  }
}

async function pdfFileFor(sqlite: Database.Database, documentId: string): Promise<string> {
  const doc = getDocument(sqlite, documentId)
  if (!doc) throw new Error(`document ${documentId} not found`)
  const file = path.join(storageDir(), `${doc.id}-v${doc.version}.pdf`)
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, await renderDocumentPdf(doc.content))
  }
  return file
}

export interface SendInput {
  job: JobRecord
  to_intended: string
  subject: string
  body: string
  attachment_doc_ids: string[]
}

// Test seam: anything with sendMail() can stand in for the SMTP transport.
export interface MailTransport {
  sendMail(opts: {
    from: string
    to: string
    subject: string
    text: string
    attachments: { filename: string; path: string }[]
  }): Promise<unknown>
}

function smtpTransport(): MailTransport {
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_APP_PASSWORD
  if (!user || !pass) {
    throw new Error('SMTP not configured: set SMTP_USER and SMTP_APP_PASSWORD (Gmail app password) in .env')
  }
  const options = {
    host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: true,
    auth: { user, pass },
    // this machine blocks direct SMTP egress; tunnel through the local proxy.
    // `proxy` is supported by nodemailer but missing from @types/nodemailer.
    proxy: process.env.SMTP_PROXY ?? 'socks5://127.0.0.1:10808',
  }
  const transporter = nodemailer.createTransport(options as Omit<typeof options, 'proxy'>)
  transporter.set('proxy_socks_module', require('socks'))
  return transporter as unknown as MailTransport
}

export async function sendApplicationEmail(
  sqlite: Database.Database,
  input: SendInput,
  transport?: MailTransport,
): Promise<EmailRecordRow> {
  const { to_actual, safe_mode } = resolveRecipient(input.to_intended)
  if (!input.to_intended.trim()) throw new Error('no recipient')
  if (input.attachment_doc_ids.length === 0) throw new Error('no attachments: generate the resume and cover letter first')

  const profile = getProfile(sqlite)
  const name = profile.contact.full_name || 'HireYou Apply'
  const attachments = []
  for (const docId of input.attachment_doc_ids) {
    const doc = getDocument(sqlite, docId)
    if (!doc) throw new Error(`document ${docId} not found`)
    attachments.push({
      filename: doc.type === 'resume' ? `${name} Resume.pdf` : `${name} Cover Letter.pdf`,
      path: await pdfFileFor(sqlite, docId),
    })
  }

  const t = transport ?? smtpTransport()
  await t.sendMail({
    from: process.env.SMTP_USER ?? 'hireyou-apply@localhost',
    to: to_actual,
    subject: input.subject,
    text: input.body,
    attachments,
  })

  const record: EmailRecordRow = {
    id: crypto.randomUUID(),
    job_id: input.job.id,
    to_intended: input.to_intended,
    to_actual,
    subject: input.subject,
    body: input.body,
    attachment_doc_ids: input.attachment_doc_ids,
    safe_mode,
    sent_at: new Date().toISOString(),
  }
  sqlite
    .prepare(
      `INSERT INTO email_records (id, job_id, to_intended, to_actual, subject, body, attachment_doc_ids, safe_mode, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.id,
      record.job_id,
      record.to_intended,
      record.to_actual,
      record.subject,
      record.body,
      JSON.stringify(record.attachment_doc_ids),
      record.safe_mode ? 1 : 0,
      record.sent_at,
    )
  return record
}

export function listEmails(sqlite: Database.Database, jobId: string): EmailRecordRow[] {
  const rows = sqlite
    .prepare(`SELECT * FROM email_records WHERE job_id = ? ORDER BY sent_at DESC`)
    .all(jobId) as (Omit<EmailRecordRow, 'attachment_doc_ids' | 'safe_mode'> & { attachment_doc_ids: string; safe_mode: number })[]
  return rows.map((r) => ({ ...r, attachment_doc_ids: JSON.parse(r.attachment_doc_ids), safe_mode: r.safe_mode === 1 }))
}
