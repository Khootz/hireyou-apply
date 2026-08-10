import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { JD_TEXT_MAX, type JobRecord } from '@app/shared'
import { api } from '../api'
import { STATUS_LABEL, STATUS_STYLE, timeAgo } from '../lib'

export function JobsPage() {
  const [jobs, setJobs] = useState<JobRecord[] | null>(null)
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

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">
          Jobs {jobs && <span className="text-sm font-normal text-slate-400">· {jobs.length} tracked</span>}
        </h1>
        <button
          className="rounded-lg bg-blue-700 text-white text-sm px-3 py-2 hover:bg-blue-800"
          onClick={() => setShowAdd(true)}
        >
          + Add Job
        </button>
      </div>
      {error && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2">{error}</div>}

      {jobs && jobs.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-500 text-sm">
          No jobs yet. Add one manually, or save one from the extension on a job board.
        </div>
      )}

      {jobs && jobs.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Materials</th>
                <th className="px-4 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link to={`/jobs/${job.id}`} className="font-medium text-slate-900 hover:text-blue-700">
                      {job.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{job.company}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-md px-2 py-0.5 text-xs ${STATUS_STYLE[job.status]}`}>
                      {STATUS_LABEL[job.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">—</td>
                  <td className="px-4 py-3 text-slate-500">{timeAgo(job.status_updated_at)}</td>
                </tr>
              ))}
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
