import type { DocumentRecord, JobInput, JobPatch, JobRecord, MasterProfile, RunRecord } from '@app/shared'

// Single-user dev auth: the token must match API_AUTH_TOKEN in .env.
// Override via localStorage.setItem('api_token', '...') if you change it.
const TOKEN = localStorage.getItem('api_token') ?? 'dev-local-token-change-me'

// When served from Vercel (or any non-local host), the API still runs on the
// user's machine — browsers treat http://127.0.0.1 as a secure origin, so the
// hosted page may call it directly. Override via localStorage 'api_base'.
const isLocalPage = ['localhost', '127.0.0.1'].includes(window.location.hostname)
export const API_BASE = localStorage.getItem('api_base') ?? (isLocalPage ? '' : 'http://127.0.0.1:3100')

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      // FormData sets its own multipart boundary; forcing JSON breaks it.
      // Bodyless requests (GET/DELETE) must not claim application/json —
      // Fastify 400s on an empty JSON body (FST_ERR_CTP_EMPTY_JSON_BODY).
      ...(isFormData || init?.body == null ? {} : { 'content-type': 'application/json' }),
      authorization: `Bearer ${TOKEN}`,
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text()}`)
  }
  return res.json() as Promise<T>
}

export interface CvParseResponse {
  draft: MasterProfile
  pages: number
  warnings: string[]
}

export const api = {
  getProfile: () => request<MasterProfile>('/api/profile'),
  saveProfile: (profile: MasterProfile) =>
    request<MasterProfile>('/api/profile', { method: 'PUT', body: JSON.stringify(profile) }),
  parseCv: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<CvParseResponse>('/api/profile/parse-cv', { method: 'POST', body: form })
  },
  getAnswers: () => request<{ answers: Record<string, string> }>('/api/answers').then((r) => r.answers),
  getAnswerVocab: () =>
    request<{ vocab: Record<string, { options: string[]; source_host: string; updated_at: string }> }>(
      '/api/answers/vocab',
    ).then((r) => r.vocab),
  saveAnswers: (answers: Record<string, string>) =>
    request<{ answers: Record<string, string> }>('/api/answers', {
      method: 'PUT',
      body: JSON.stringify({ answers }),
    }).then((r) => r.answers),
  listJobs: () => request<{ jobs: JobRecord[] }>('/api/jobs'),
  createJob: (input: Partial<JobInput>) =>
    request<{ job: JobRecord; deduped: boolean }>('/api/jobs', { method: 'POST', body: JSON.stringify(input) }),
  getJob: (id: string) => request<JobRecord>(`/api/jobs/${id}`),
  patchJob: (id: string, patch: JobPatch) =>
    request<JobRecord>(`/api/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteJob: (id: string) => request<{ deleted: boolean }>(`/api/jobs/${id}`, { method: 'DELETE' }),
  generate: (jobId: string, type: 'resume' | 'cover_letter') =>
    request<{ run: RunRecord; deduped: boolean }>(`/api/jobs/${jobId}/generate`, {
      method: 'POST',
      body: JSON.stringify({ type }),
    }),
  getRun: (id: string) => request<RunRecord>(`/api/runs/${id}`),
  listDocuments: (jobId: string) =>
    request<{ documents: Omit<DocumentRecord, 'content'>[] }>(`/api/jobs/${jobId}/documents`),
  getDocument: (id: string) => request<DocumentRecord>(`/api/documents/${id}`),
}

// iframes/new tabs can't carry the Authorization header; PDF GETs accept the
// token as a query parameter instead.
export function pdfUrl(documentId: string): string {
  return `${API_BASE}/api/documents/${documentId}/pdf?token=${encodeURIComponent(TOKEN)}`
}

export function profilePdfUrl(version: number): string {
  return `${API_BASE}/api/profile/pdf?token=${encodeURIComponent(TOKEN)}&v=${version}`
}

export const profilePdfMeta = () => request<{ pages: number }>(`/api/profile/pdf/meta`)

export interface EmailDraft {
  to_intended: string
  to_actual: string
  safe_mode: boolean
  subject: string
  body: string
  attachments: { document_id: string; type: string; version: number; filename: string }[]
  problems: string[]
}

export interface EmailRecord {
  id: string
  to_intended: string
  to_actual: string
  subject: string
  safe_mode: boolean
  sent_at: string
}

export const emailApi = {
  preview: (jobId: string) => request<EmailDraft>(`/api/jobs/${jobId}/email/preview`),
  send: (jobId: string, payload: { to?: string; subject: string; body: string; attachment_doc_ids: string[] }) =>
    request<{ sent: boolean; record: EmailRecord }>(`/api/jobs/${jobId}/email/send`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  history: (jobId: string) => request<{ emails: EmailRecord[] }>(`/api/jobs/${jobId}/emails`),
}
