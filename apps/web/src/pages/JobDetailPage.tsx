import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { JOB_STATUSES, type JobRecord, type JobStatus } from '@app/shared'
import { api } from '../api'
import { STATUS_LABEL, STATUS_STYLE } from '../lib'

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
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-900">📄 Resume</div>
          <p className="text-xs text-slate-400 mt-2">Tailored generation arrives with M4.</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-900">✉️ Cover Letter</div>
          <p className="text-xs text-slate-400 mt-2">Tailored generation arrives with M4.</p>
        </div>
      </div>
    </div>
  )
}
