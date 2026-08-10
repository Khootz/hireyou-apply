import type { JobStatus } from '@app/shared'

export function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 0) return 'Today'
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export const STATUS_STYLE: Record<JobStatus, string> = {
  saved: 'bg-slate-100 text-slate-700',
  applied: 'bg-blue-100 text-blue-700',
  interviewing: 'bg-amber-100 text-amber-700',
  offered: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-600',
}

export const STATUS_LABEL: Record<JobStatus, string> = {
  saved: 'Saved',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offered: 'Offered',
  rejected: 'Rejected',
}
