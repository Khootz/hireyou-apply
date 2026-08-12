import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  JOB_STATUSES,
  type CoverLetterDocument,
  type DocumentRecord,
  type JobRecord,
  type JobStatus,
  type ResumeDocument,
} from '@app/shared'
import { api, emailApi, pdfUrl, type EmailDraft, type EmailRecord } from '../api'
import { STATUS_LABEL, STATUS_STYLE, timeAgo } from '../lib'

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [job, setJob] = useState<JobRecord | null>(null)
  const [error, setError] = useState('')
  const notesTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (!id) return
    api
      .getJob(id)
      .then(setJob)
      .catch((e) => setError((e as Error).message))
  }, [id])

  if (error) {
    return <div className="mx-auto max-w-3xl px-4 py-16 text-red-600 text-sm">{error}</div>
  }
  if (!job) {
    return <div className="mx-auto max-w-3xl px-4 py-16 text-slate-500 text-sm">Loading…</div>
  }

  const setStatus = async (status: JobStatus) => {
    setJob(await api.patchJob(job.id, { status }))
  }

  const setNotes = (notes: string) => {
    setJob({ ...job, notes })
    clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(() => {
      api.patchJob(job.id, { notes }).catch(() => {})
    }, 800)
  }

  const remove = async () => {
    if (!window.confirm(`Delete "${job.title}" at ${job.company}?`)) return
    try {
      await api.deleteJob(job.id)
    } catch (e) {
      setError((e as Error).message)
      return
    }
    navigate('/jobs')
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-5">
      <div className="flex items-center justify-between">
        <Link to="/jobs" className="text-sm text-slate-500 hover:text-blue-700">
          ← All Jobs
        </Link>
        <button className="text-sm text-red-400 hover:text-red-600" onClick={remove}>
          Delete Job
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{job.title}</h1>
            <div className="text-sm text-slate-600 mt-1">
              {job.company}
              {job.source_url && (
                <a
                  className="ml-2 text-blue-600 hover:underline"
                  href={job.source_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Link ↗
                </a>
              )}
            </div>
          </div>
          <div className="flex gap-1 flex-wrap justify-end">
            {JOB_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`rounded-md px-2.5 py-1 text-xs border ${
                  job.status === s
                    ? `${STATUS_STYLE[s]} border-transparent font-medium`
                    : 'text-slate-400 border-slate-200 hover:border-slate-400'
                }`}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        {(job.location || job.deadline || job.apply_email) && (
          <div className="text-sm text-slate-500">
            {[job.location, job.deadline && `Deadline: ${job.deadline}`, job.apply_email && `Apply: ${job.apply_email}`]
              .filter(Boolean)
              .join(' · ')}
          </div>
        )}

        {job.jd_text ? (
          <JdView text={job.jd_text} />
        ) : (
          <div className="text-sm text-slate-400 border-t border-slate-100 pt-4">No job description saved.</div>
        )}

        <div className="border-t border-slate-100 pt-4">
          <div className="text-xs font-semibold tracking-widest text-slate-500 mb-2">NOTES</div>
          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-16 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Add personal notes…"
            value={job.notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <GenerationCard jobId={job.id} type="resume" label="Resume" />
        <GenerationCard jobId={job.id} type="cover_letter" label="Cover Letter" />
      </div>

      <EmailCard job={job} onApplied={() => setStatus('applied')} />
    </div>
  )
}

// Job descriptions saved as plain text render as-is; descriptions written in
// a light markdown (## headings, - bullets, | key | value | rows) render as
// styled sections so curated postings look presentable.
function JdView({ text }: { text: string }) {
  if (!/^## /m.test(text)) {
    return <div className="text-sm text-slate-700 whitespace-pre-wrap border-t border-slate-100 pt-4">{text}</div>
  }

  type Block =
    | { kind: 'heading'; text: string }
    | { kind: 'table'; rows: string[][] }
    | { kind: 'bullets'; items: string[] }
    | { kind: 'paragraph'; text: string }

  const blocks: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length > 0) blocks.push({ kind: 'paragraph', text: para.join(' ') })
    para = []
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) {
      flush()
    } else if (line.startsWith('## ')) {
      flush()
      blocks.push({ kind: 'heading', text: line.slice(3) })
    } else if (line.startsWith('|')) {
      flush()
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean)
      const last = blocks[blocks.length - 1]
      if (last?.kind === 'table') last.rows.push(cells)
      else blocks.push({ kind: 'table', rows: [cells] })
    } else if (line.startsWith('- ')) {
      flush()
      const last = blocks[blocks.length - 1]
      if (last?.kind === 'bullets') last.items.push(line.slice(2))
      else blocks.push({ kind: 'bullets', items: [line.slice(2)] })
    } else {
      para.push(line)
    }
  }
  flush()

  return (
    <div className="text-sm text-slate-700 border-t border-slate-100 pt-4 space-y-3">
      {blocks.map((b, i) => {
        if (b.kind === 'heading')
          return (
            <div key={i} className="text-xs font-semibold tracking-widest text-slate-500 uppercase pt-2">
              {b.text}
            </div>
          )
        if (b.kind === 'table')
          return (
            <div key={i} className="rounded-lg border border-slate-200 divide-y divide-slate-100 overflow-hidden">
              {b.rows.map((cells, r) => (
                <div key={r} className="flex text-sm">
                  <div className="w-44 shrink-0 bg-slate-50 px-3 py-2 text-slate-500">{cells[0]}</div>
                  <div className="px-3 py-2 text-slate-800">{cells.slice(1).join(' · ')}</div>
                </div>
              ))}
            </div>
          )
        if (b.kind === 'bullets')
          return (
            <ul key={i} className="list-disc pl-5 space-y-1">
              {b.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          )
        return (
          <p key={i} className="leading-relaxed">
            {b.text}
          </p>
        )
      })}
    </div>
  )
}

function EmailCard({ job, onApplied }: { job: JobRecord; onApplied: () => void }) {
  const [draft, setDraft] = useState<EmailDraft | null>(null)
  const [history, setHistory] = useState<EmailRecord[]>([])
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sentJustNow, setSentJustNow] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(() => {
    emailApi
      .preview(job.id)
      .then((d) => {
        setDraft(d)
        setTo(d.to_intended)
        setSubject(d.subject)
        setBody(d.body)
      })
      .catch(() => {})
    emailApi
      .history(job.id)
      .then((r) => setHistory(r.emails))
      .catch(() => {})
  }, [job.id])

  useEffect(() => {
    reload()
  }, [reload])

  if (!draft) return null

  const canSend = draft.attachments.length === 2 && (to.trim() || draft.to_intended)

  const send = async () => {
    setSending(true)
    setError('')
    try {
      await emailApi.send(job.id, {
        to: to.trim() || undefined,
        subject,
        body,
        attachment_doc_ids: draft.attachments.map((a) => a.document_id),
      })
      setSentJustNow(true)
      reload()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-slate-900">Apply by email</div>
        {draft.safe_mode && (
          <span className="text-[11px] rounded-md bg-amber-100 text-amber-800 px-2 py-0.5">
            SAFE MODE — delivers to {draft.to_actual}
          </span>
        )}
      </div>

      {draft.problems.length > 0 && (
        <ul className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2 space-y-0.5">
          {draft.problems.map((p) => (
            <li key={p}>• {p}</li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-slate-500">To (employer)</span>
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={to}
            placeholder="hr@company.com"
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500">Subject</span>
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>
      </div>
      <textarea
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-40 font-mono"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">
          {draft.attachments.length > 0
            ? draft.attachments.map((a) => `${a.filename} (v${a.version})`).join(' · ')
            : 'No attachments yet — generate the documents above first.'}
        </div>
        <button
          className="rounded-lg bg-blue-700 text-white text-sm px-4 py-2 hover:bg-blue-800 disabled:opacity-50"
          disabled={!canSend || sending}
          onClick={send}
        >
          {sending ? 'Sending…' : 'Send application'}
        </button>
      </div>
      {error && <div className="text-xs text-red-600 bg-red-50 rounded p-2">{error}</div>}
      {sentJustNow && (
        <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          <span className="text-sm text-green-700">✓ Sent{draft.safe_mode ? ` (safe mode → ${draft.to_actual})` : ''}</span>
          {job.status === 'saved' && (
            <button className="text-sm text-blue-700 hover:underline" onClick={onApplied}>
              Mark as Applied
            </button>
          )}
        </div>
      )}
      {history.length > 0 && (
        <div className="text-xs text-slate-400 border-t border-slate-100 pt-2 space-y-0.5">
          {history.map((h) => (
            <div key={h.id}>
              {timeAgo(h.sent_at)} — sent to {h.to_actual}
              {h.safe_mode && h.to_intended !== h.to_actual ? ` (intended: ${h.to_intended || '—'})` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Staged progress bar shown while a run is in flight — the same demo pacing
// the extension uses for form scans. The bar eases to ~95% over a few seconds
// and holds there until the run actually reports success, so it stays honest
// for slow (real LLM) runs and feels alive for fast (demo-cached) ones.
const GEN_STAGES: Record<'resume' | 'cover_letter', [number, string][]> = {
  resume: [
    [0, 'Reading the job description…'],
    [0.35, 'Selecting your most relevant experience…'],
    [0.7, 'Tailoring bullet points to the role…'],
    [0.92, 'Formatting the document…'],
  ],
  cover_letter: [
    [0, 'Reading the job description…'],
    [0.35, 'Matching your background to the role…'],
    [0.7, 'Drafting the letter…'],
    [0.92, 'Polishing the wording…'],
  ],
}

function GenerationCard({
  jobId,
  type,
  label,
}: {
  jobId: string
  type: 'resume' | 'cover_letter'
  label: string
}) {
  const [docs, setDocs] = useState<Omit<DocumentRecord, 'content'>[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [viewing, setViewing] = useState<DocumentRecord | null>(null)
  const pollTimer = useRef<ReturnType<typeof setInterval>>()
  const barTimer = useRef<ReturnType<typeof setInterval>>()

  const reload = useCallback(
    () =>
      api
        .listDocuments(jobId)
        .then((r) => setDocs(r.documents.filter((d) => d.type === type)))
        .catch(() => {}),
    [jobId, type],
  )

  useEffect(() => {
    reload()
    return () => {
      clearInterval(pollTimer.current)
      clearInterval(barTimer.current)
    }
  }, [reload])

  const finish = async (documentId: string | null) => {
    clearInterval(pollTimer.current)
    clearInterval(barTimer.current)
    setProgress(1)
    await reload()
    // Land on 100% for a beat, then open the finished document.
    setTimeout(async () => {
      setBusy(false)
      setProgress(0)
      if (documentId) {
        try {
          setViewing(await api.getDocument(documentId))
        } catch {
          /* list already refreshed; the row is still there to open manually */
        }
      }
    }, 400)
  }

  const generate = async () => {
    setBusy(true)
    setError('')
    setProgress(0)
    const t0 = Date.now()
    barTimer.current = setInterval(() => {
      // Ease toward 95% over ~3.5s, then hold until the run reports back.
      const t = Math.min(1, (Date.now() - t0) / 3500)
      setProgress(0.95 * (1 - Math.pow(1 - t, 2.2)))
    }, 110)
    try {
      const { run } = await api.generate(jobId, type)
      pollTimer.current = setInterval(async () => {
        const status = await api.getRun(run.id)
        if (status.status === 'succeeded') {
          void finish(status.document_id)
        } else if (status.status === 'failed') {
          clearInterval(pollTimer.current)
          clearInterval(barTimer.current)
          setBusy(false)
          setProgress(0)
          setError(status.error ?? 'Generation failed')
        }
      }, 700)
    } catch (err) {
      clearInterval(barTimer.current)
      setBusy(false)
      setProgress(0)
      setError((err as Error).message)
    }
  }

  const stageLabel = GEN_STAGES[type].filter(([at]) => at <= progress).pop()?.[1] ?? ''

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-slate-900">{label}</div>
        <button
          className={`rounded-lg text-white text-sm px-3 py-1.5 disabled:opacity-50 ${
            type === 'resume' ? 'bg-blue-700 hover:bg-blue-800' : 'bg-green-700 hover:bg-green-800'
          }`}
          disabled={busy}
          onClick={generate}
        >
          {busy ? 'Generating…' : docs.length > 0 ? 'Regenerate' : `Generate ${label}`}
        </button>
      </div>
      {busy ? (
        <div className="space-y-1.5">
          <div className="text-xs text-slate-500">{stageLabel}</div>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full ${type === 'resume' ? 'bg-blue-600' : 'bg-green-600'}`}
              style={{ width: `${Math.round(progress * 100)}%`, transition: 'width 120ms linear' }}
            />
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-400">Tailored to this job.</p>
      )}
      {error && <div className="text-xs text-red-600 bg-red-50 rounded p-2">{error}</div>}
      {docs.map((d) => (
        <button
          key={d.id}
          className="w-full text-left text-sm border border-slate-200 rounded-lg px-3 py-2 hover:border-blue-400 flex justify-between"
          onClick={() => api.getDocument(d.id).then(setViewing)}
        >
          <span className="text-slate-700">
            v{d.version} <span className="text-slate-400">· {timeAgo(d.created_at)}</span>
          </span>
          <span className="text-blue-600 text-xs">view</span>
        </button>
      ))}
      {viewing && <DocumentViewer doc={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

function DocumentViewer({ doc, onClose }: { doc: DocumentRecord; onClose: () => void }) {
  const c = doc.content
  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-8 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <span className="text-xs text-slate-400">
            {doc.type === 'resume' ? 'Tailored resume' : 'Cover letter'} · v{doc.version}
          </span>
          <div className="flex items-center gap-3">
            <a
              className="text-sm text-blue-700 hover:underline"
              href={pdfUrl(doc.id)}
              target="_blank"
              rel="noreferrer"
            >
              Open PDF
            </a>
            <button className="text-slate-400 hover:text-slate-700" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>
        <iframe title="PDF preview" src={pdfUrl(doc.id)} className="w-full h-[65vh] rounded-lg border border-slate-200" />
        <details>
          <summary className="text-xs text-slate-400 cursor-pointer">Structured view</summary>
          <div className="pt-3">{c.kind === 'resume' ? <ResumeView content={c} /> : <CoverLetterView content={c} />}</div>
        </details>
      </div>
    </div>
  )
}

function ResumeView({ content }: { content: ResumeDocument }) {
  return (
    <div className="font-serif text-sm text-slate-900 space-y-4">
      <div className="text-center">
        <div className="text-lg font-semibold">{content.contact.full_name}</div>
        <div className="text-xs text-slate-500">
          {[content.contact.email, content.contact.phone, content.contact.location].filter(Boolean).join(' · ')}
        </div>
      </div>
      {content.sections.map((s, i) => (
        <div key={i}>
          <div className="font-semibold uppercase tracking-wide text-xs border-b border-slate-300 pb-1 mb-2">{s.title}</div>
          {s.type === 'paragraph' && <p className="text-justify">{s.text}</p>}
          {s.type === 'bullets' && (
            <ul className="list-disc pl-5 space-y-0.5">
              {s.items.map((b) => (
                <li key={b.source_fact_id}>{b.text}</li>
              ))}
            </ul>
          )}
          {s.type === 'experience' &&
            s.entries.map((e) => (
              <div key={e.source_fact_id} className="mb-2">
                <div className="flex justify-between">
                  <span className="font-medium">
                    {e.organisation}
                    {e.role && <span className="font-normal"> — {e.role}</span>}
                  </span>
                  <span className="text-xs text-slate-500">
                    {[e.start_date, e.is_current ? 'Present' : e.end_date].filter(Boolean).join(' – ')}
                  </span>
                </div>
                <ul className="list-disc pl-5 space-y-0.5">
                  {e.bullets.map((b) => (
                    <li key={b.source_fact_id}>{b.text}</li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      ))}
    </div>
  )
}

function CoverLetterView({ content }: { content: CoverLetterDocument }) {
  return (
    <div className="font-serif text-sm text-slate-900 space-y-4">
      <div className="text-right">
        <div>{content.contact.full_name}</div>
        <div className="text-xs text-slate-500">{content.contact.email}</div>
        <div className="text-xs text-slate-500">{content.date}</div>
      </div>
      <div className="text-center font-semibold">
        Application for {content.company} {content.role}
      </div>
      <div>{content.salutation}</div>
      {content.paragraphs.map((p, i) => (
        <p key={i} className="text-justify">
          {p}
        </p>
      ))}
      <div>
        {content.signoff}
        <br />
        {content.contact.full_name}
      </div>
    </div>
  )
}
