import fs from 'node:fs'
import path from 'node:path'
import puppeteer, { type Browser } from 'puppeteer-core'
import type { CoverLetterDocument, DocumentContent, ResumeDocument } from '@app/shared'

// One layout engine for preview AND export: the API renders the PDF and the
// web app displays that same PDF, so the page count can never lie (spec §7).
// puppeteer-core drives the system Chrome — no 150MB bundled download, which
// would be blocked on this machine's network anyway.

let browser: Browser | null = null

async function getBrowser(): Promise<Browser> {
  if (browser && browser.connected) return browser
  browser = await puppeteer.launch({ channel: 'chrome', headless: true })
  return browser
}

export async function closePdfBrowser(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => {})
    browser = null
  }
}

export async function renderDocumentPdf(content: DocumentContent): Promise<Buffer> {
  const html = content.kind === 'resume' ? resumeHtml(content) : coverLetterHtml(content)
  const b = await getBrowser()
  const page = await b.newPage()
  try {
    await page.setContent(html, { waitUntil: 'load' })
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '18mm', right: '18mm' },
    })
    return Buffer.from(pdf)
  } finally {
    await page.close().catch(() => {})
  }
}

export function storageDir(): string {
  const dir = process.env.PDF_STORAGE_DIR ?? path.resolve('apps/api/storage')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const BASE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 10.5pt;
    line-height: 1.35;
    color: #111;
  }
  p { text-align: justify; hyphens: auto; }
  .section-title {
    font-size: 10pt;
    font-weight: bold;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    border-bottom: 0.8pt solid #111;
    margin: 10pt 0 5pt;
    padding-bottom: 1.5pt;
  }
  ul { padding-left: 14pt; }
  li { text-align: justify; hyphens: auto; margin-bottom: 1.5pt; }
  .row { display: flex; justify-content: space-between; align-items: baseline; }
  .muted { color: #333; }
`

function contactLine(c: ResumeDocument['contact']): string {
  return [c.email, c.phone, c.location].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ')
}

function resumeHtml(doc: ResumeDocument): string {
  const sections = doc.sections
    .map((s) => {
      if (s.type === 'paragraph') {
        return `<div class="section-title">${esc(s.title)}</div><p>${esc(s.text)}</p>`
      }
      if (s.type === 'bullets') {
        return `<div class="section-title">${esc(s.title)}</div><ul>${s.items
          .map((b) => `<li>${esc(b.text)}</li>`)
          .join('')}</ul>`
      }
      const entries = s.entries
        .map((e) => {
          const dates = [e.start_date, e.is_current ? 'Present' : e.end_date].filter(Boolean).join(' – ')
          const left = `<strong>${esc(e.organisation)}</strong>${e.role ? ` — ${esc(e.role)}` : ''}`
          const right = [dates, e.location].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ')
          const bullets = e.bullets.length
            ? `<ul>${e.bullets.map((b) => `<li>${esc(b.text)}</li>`).join('')}</ul>`
            : ''
          return `<div style="margin-bottom:5pt"><div class="row"><span>${left}</span><span class="muted" style="font-size:9.5pt">${right}</span></div>${bullets}</div>`
        })
        .join('')
      return `<div class="section-title">${esc(s.title)}</div>${entries}`
    })
    .join('')

  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    .name { text-align: center; font-size: 16pt; font-weight: bold; letter-spacing: 0.04em; }
    .contact { text-align: center; font-size: 9.5pt; margin-top: 2pt; }
  </style></head><body>
    <div class="name">${esc(doc.contact.full_name)}</div>
    <div class="contact">${contactLine(doc.contact)}</div>
    ${sections}
  </body></html>`
}

function coverLetterHtml(doc: CoverLetterDocument): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    body { font-size: 11pt; line-height: 1.45; }
    .header { text-align: right; margin-bottom: 18pt; }
    .subject { text-align: center; font-weight: bold; margin: 14pt 0; }
    p.body { margin-bottom: 9pt; }
  </style></head><body>
    <div class="header">
      ${esc(doc.contact.full_name)}<br>
      ${esc(doc.contact.email)}${doc.contact.phone ? `<br>${esc(doc.contact.phone)}` : ''}<br>
      ${esc(doc.date)}
    </div>
    <div>Recruitment Team<br>${esc(doc.company)}</div>
    <div class="subject">Application for ${esc(doc.role)} — ${esc(doc.company)}</div>
    <div style="margin-bottom:9pt">${esc(doc.salutation)}</div>
    ${doc.paragraphs.map((p) => `<p class="body">${esc(p)}</p>`).join('')}
    <div style="margin-top:14pt">${esc(doc.signoff)}<br><br>${esc(doc.contact.full_name)}</div>
  </body></html>`
}
