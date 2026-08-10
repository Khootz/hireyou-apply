import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { JD_TEXT_MAX, JOB_STATUSES, type JobRecord, type JobStatus } from '@app/shared'
import { api } from '../api'
import { STATUS_LABEL, timeAgo } from '../lib'

const DOT: Record<JobStatus, string> = {
  saved: 'bg-slate-400',
  applied: 'bg-blue-500',
  interviewing: 'bg-amber-500',
  offered: 'bg-green-500',
  rejected: 'bg-red-400',
}

type Filter = 'all' | JobStatus

export function JobsPage() {
  const [jobs, setJobs] = useState<JobRecord[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [error, setError] = useState('')

  const reload = () =>
    api
      .listJobs()
      .then((r) => setJobs(r.jobs))
      .catch((e) => setError((e as Error).message))

  useEffect(() => {
    reload()
  }, [])

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: jobs?.length ?? 0, saved: 0, applied: 0, interviewing: 0, offered: 0, rejected: 0 }
    for (const j of jobs ?? []) c[j.status]++
    return c
  }, [jobs])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (jobs ?? []).filter(
      (j) =>
        (filter === 'all' || j.status === filter) &&
        (!q || j.title.toLowerCase().includes(q) || j.company.toLowerCase().includes(q)),
    )
  }, [jobs, filter, search])

  const setStatus = async (job: JobRecord, status: JobStatus) => {
    setJobs((prev) => prev?.map((j) => (j.id === job.id ? { ...j, status } : j)) ?? null)
    try {
      await api.patchJob(job.id, { status })
    } finally {
      reload()
    }
  }

  const remove = async (job: JobRecord) => {
    if (!window.confirm(`Delete "${job.title}" at ${job.company}?`)) return
    await api.deleteJob(job.id)
    reload()
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Jobs</h1>
          <div className="text-sm text-slate-500 mt-0.5">
            {jobs ? `${jobs.length} job${jobs.length === 1 ? '' : 's'} tracked` : 'Loading…'}
          </div>
        </div>
        <button
          className="rounded-lg bg-blue-700 text-white text-sm font-medium px-4 py-2.5 hover:bg-blue-800"
          onClick={() => setShowAdd(true)}
        >
          + Add Job
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {(['all', ...JOB_STATUSES] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3.5 py-1.5 text-sm border ${
              filter === f
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
            }`}
          >
            {f === 'all' ? 'All' : STATUS_LABEL[f]} ({counts[f]})
          </button>
        ))}
      </div>

      <input
        className="w-full max-w-xl rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder="Search by title or company…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {error && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2">{error}</div>}

      {jobs && jobs.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-500 text-sm">
          No jobs yet. Add one manually, or save one from the extension on the HKUST career board.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="px-4 py-3 font-medium tracking-wide">TITLE</th>
                <th className="px-4 py-3 font-medium tracking-wide">COMPANY</th>
                <th className="px-4 py-3 font-medium tracking-wide">STATUS</th>
                <th className="px-4 py-3 font-medium tracking-wide">MATERIALS</th>
                <th className="px-4 py-3 font-medium tracking-wide">DATE</th>
                <th className="px-2 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((job) => (
                <tr key={job.id} className="border-b border-slate-50 hover:bg-slate-50 group">
                  <td className="px-4 py-3.5">
                    <Link to={`/jobs/${job.id}`} className="font-medium text-slate-900 hover:text-blue-700">
                      {job.title}
                    </Link>
                    {job.source_url && (
                      <a className="ml-1.5 text-slate-400 hover:text-blue-600 text-xs" href={job.source_url} target="_blank" rel="noreferrer" title="Open posting">
                        ↗
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-slate-600">{job.company}</td>
                  <td className="px-4 py-3.5">
                    <span className="inline-flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${DOT[job.status]}`} />
                      <select
                        className="rounded-lg border border-slate-200 px-2 py-1 text-sm bg-white hover:border-slate-400"
                        value={job.status}
                        onChange={(e) => setStatus(job, e.target.value as JobStatus)}
                      >
                        {JOB_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    {job.materials?.length ? (
                      <span className="flex gap-1.5">
                        {job.materials.includes('resume') && (
                          <Link to={`/jobs/${job.id}`} className="rounded-md bg-blue-50 text-blue-700 px-2 py-0.5 text-xs">
                            Resume
                          </Link>
                        )}
                        {job.materials.includes('cover_letter') && (
                          <Link to={`/jobs/${job.id}`} className="rounded-md bg-green-50 text-green-700 px-2 py-0.5 text-xs">
                            Cover
                          </Link>
                        )}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-slate-500">{timeAgo(job.status_updated_at)}</td>
                  <td className="px-2 py-3.5">
                    <button
                      className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                      title="Delete"
                      onClick={() => remove(job)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-sm">
                    Nothing matches this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddJobDialog
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false)
            reload()
          }}
        />
      )}
    </div>
  )
}

function AddJobDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    title: '',
    company: '',
    location: '',
    source_url: '',
    jd_text: '',
    apply_email: '',
    deadline: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await api.createJob({
        ...form,
        apply_email: form.apply_email || null,
        source_board: 'manual',
      })
      onCreated()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-6 space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Add job</h2>
        {error && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Job title *" value={form.title} onChange={set('title')} />
          <Input label="Company *" value={form.company} onChange={set('company')} />
          <Input label="Location" value={form.location} onChange={set('location')} />
          <Input label="Job URL" value={form.source_url} onChange={set('source_url')} />
          <Input label="Apply email" value={form.apply_email} onChange={set('apply_email')} placeholder="hr@company.com" />
          <Input label="Deadline" value={form.deadline} onChange={set('deadline')} placeholder="2026-09-30" />
        </div>
        <label className="block">
          <span className="text-xs text-slate-500">
            Job description ({form.jd_text.length}/{JD_TEXT_MAX})
          </span>
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-32 focus:outline-none focus:ring-2 focus:ring-blue-500"
            maxLength={JD_TEXT_MAX}
            value={form.jd_text}
            onChange={set('jd_text')}
          />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50" onClick={onClose}>
            Cancel
          </button>
          <button
            className="rounded-lg bg-blue-700 text-white px-4 py-2 text-sm hover:bg-blue-800 disabled:opacity-50"
            disabled={busy || !form.title.trim() || !form.company.trim()}
            onClick={submit}
          >
            {busy ? 'Saving…' : 'Save job'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Input({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        value={value}
        placeholder={placeholder}
        onChange={onChange}
      />
    </label>
  )
}
