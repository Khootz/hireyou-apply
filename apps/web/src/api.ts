import type { MasterProfile } from '@app/shared'

// Single-user dev auth: the token must match API_AUTH_TOKEN in .env.
// Override via localStorage.setItem('api_token', '...') if you change it.
const TOKEN = localStorage.getItem('api_token') ?? 'dev-local-token-change-me'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text()}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  getProfile: () => request<MasterProfile>('/api/profile'),
  saveProfile: (profile: MasterProfile) =>
    request<MasterProfile>('/api/profile', { method: 'PUT', body: JSON.stringify(profile) }),
}
