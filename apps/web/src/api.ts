import type { MasterProfile } from '@app/shared'

// Single-user dev auth: the token must match API_AUTH_TOKEN in .env.
// Override via localStorage.setItem('api_token', '...') if you change it.
const TOKEN = localStorage.getItem('api_token') ?? 'dev-local-token-change-me'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData
  const res = await fetch(path, {
    ...init,
    headers: {
      // FormData sets its own multipart boundary; forcing JSON breaks it.
      ...(isFormData ? {} : { 'content-type': 'application/json' }),
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
}
