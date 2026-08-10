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
    await api.deleteJob(job.id)
    navigate('/jobs')
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-5">
      <div className="flex items-center justify-between">
        <Link to="/jobs" className="text-sm text-slate-500 hover:text-blue-700">
          ← All Jobs
        </Link>
        <button className="text-sm text-red-400 hover:text-red-600" onClick={remove}>
          🗑 Delete Job
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
          <div className="text-sm text-slate-700 whitespace-pre-wrap border-t border-slate-100 pt-4">{job.jd_text}</div>
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
        <GenerationCard jobId={job.id} type="resume" icon="📄" label="Resume" />
        <GenerationCard jobId={job.id} type="cover_letter" icon="✉️" label="Cover Letter" />
      </div>

      <EmailCard job={job} onApplied={() => setStatus('applied')} />
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
        <div className="text-sm font-medium text-slate-900">📮 Apply by email</div>
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
            ? `📎 ${draft.attachments.map((a) => `${a.filename} (v${a.version})`).join(' · ')}`
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

function GenerationCard({
  jobId,
  type,
  icon,
  label,
}: {
  jobId: string
  type: 'resume' | 'cover_letter'
  icon: string
  label: string
}) {
  const [docs, setDocs] = useState<Omit<DocumentRecord, 'content'>[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [viewing, setViewing] = useState<DocumentRecord | null>(null)
  const pollTimer = useRef<ReturnType<typeof setInterval>>()

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
    return () => clearInterval(pollTimer.current)
  }, [reload])

  const generate = async () => {
    setBusy(true)
    setError('')
    try {
      const { run } = await api.generate(jobId, type)
      pollTimer.current = setInterval(async () => {
        const status = await api.getRun(run.id)
        if (status.status === 'succeeded') {
          clearInterval(pollTimer.current)
          setBusy(false)
          reload()
        } else if (status.status === 'failed') {
          clearInterval(pollTimer.current)
          setBusy(false)
          setError(status.error ?? 'Generation failed')
        }
      }, 1500)
    } catch (err) {
      setBusy(false)
      setError((err as Error).message)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
          {icon} {label}
        </div>
        <button
          className={`rounded-lg text-white text-sm px-3 py-1.5 disabled:opacity-50 ${
            type === 'resume' ? 'bg-blue-700 hover:bg-blue-800' : 'bg-green-700 hover:bg-green-800'
          }`}
          disabled={busy}
          onClick={generate}
        >
          {busy ? 'Generating… ~20s' : docs.length > 0 ? 'Regenerate' : `✨ Generate ${label}`}
        </button>
      </div>
      <p className="text-xs text-slate-400">Tailored to this job.</p>
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
              ⬇ Open PDF
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
