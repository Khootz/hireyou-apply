import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { FieldInfoSchema, type FieldInfo } from '@app/shared/autofill'
import { openDb } from '../src/db'
import { formFingerprint } from '../src/services/autofill'
import { recordKeySightings, rotationReminders } from '../src/services/keyRotation'
import { buildServer } from '../src/server'

// M9 hardening: suggestion telemetry (events endpoint + fingerprint exposure)
// and the key-rotation reminder (hash-only tracking, threshold nag).

const AUTH = { authorization: 'Bearer test-token' }

// email/phone classify deterministically → no LLM call, no fixture needed
const FIELDS: FieldInfo[] = [
  FieldInfoSchema.parse({ selector: '#email', tag: 'input', input_type: 'email', label: 'Email' }),
  FieldInfoSchema.parse({ selector: '#phone', tag: 'input', input_type: 'tel', label: 'Phone' }),
]

let app: FastifyInstance
let sqlite: Database.Database

beforeAll(() => {
  process.env.API_AUTH_TOKEN = 'test-token'
})

beforeEach(() => {
  sqlite = openDb(':memory:').sqlite
  app = buildServer({ sqlite })
})

describe('suggestion telemetry', () => {
  it('POST /api/autofill returns the form fingerprint alongside suggestions', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/autofill',
      headers: AUTH,
      payload: { fields: FIELDS, job_id: null },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { suggestions: unknown[]; form_fingerprint: string }
    expect(body.suggestions).toHaveLength(2)
    expect(body.form_fingerprint).toBe(formFingerprint(FIELDS))
    expect(body.form_fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('records copied/dismissed/ignored events against the fingerprint', async () => {
    const fp = formFingerprint(FIELDS)
    const res = await app.inject({
      method: 'POST',
      url: '/api/autofill/events',
      headers: AUTH,
      payload: {
        form_fingerprint: fp,
        events: [
          { canonical_field: 'email', action: 'copied' },
          { canonical_field: 'phone', action: 'ignored' },
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ recorded: 2 })
    const rows = sqlite
      .prepare(`SELECT canonical_field, action FROM field_suggestion_events WHERE form_fingerprint = ? ORDER BY canonical_field`)
      .all(fp) as { canonical_field: string; action: string }[]
    expect(rows).toEqual([
      { canonical_field: 'email', action: 'copied' },
      { canonical_field: 'phone', action: 'ignored' },
    ])
  })

  it('rejects unknown actions and empty batches', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/autofill/events',
      headers: AUTH,
      payload: { form_fingerprint: 'abc', events: [{ canonical_field: 'email', action: 'auto_submitted' }] },
    })
    expect(bad.statusCode).toBe(400)
    const empty = await app.inject({
      method: 'POST',
      url: '/api/autofill/events',
      headers: AUTH,
      payload: { form_fingerprint: 'abc', events: [] },
    })
    expect(empty.statusCode).toBe(400)
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM field_suggestion_events`).get()).toEqual({ n: 0 })
  })

  it('requires auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/autofill/events',
      payload: { form_fingerprint: 'abc', events: [{ canonical_field: 'email', action: 'copied' }] },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('key-rotation reminder', () => {
  const NOW = new Date('2026-08-11T00:00:00Z')
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

  it('stores a hash + first-seen date, never the secret itself', () => {
    const env = { DEEPSEEK_API_KEY: 'sk-SUPER-SECRET-VALUE' } as NodeJS.ProcessEnv
    recordKeySightings(sqlite, env, NOW)
    const row = sqlite
      .prepare(`SELECT value FROM app_meta WHERE key = 'key_rotation:DEEPSEEK_API_KEY'`)
      .get() as { value: string }
    expect(row.value).not.toContain('SUPER-SECRET')
    expect(JSON.parse(row.value)).toMatchObject({ first_seen: NOW.toISOString() })
  })

  it('stays quiet while the key is fresh, nags past the threshold', () => {
    const env = { DEEPSEEK_API_KEY: 'sk-old-key' } as NodeJS.ProcessEnv
    recordKeySightings(sqlite, env, daysAgo(10))
    expect(rotationReminders(sqlite, env, NOW)).toEqual([])

    recordKeySightings(sqlite, env, daysAgo(45)) // unchanged hash → first_seen kept at 10 days
    expect(rotationReminders(sqlite, env, NOW)).toEqual([])

    sqlite.prepare(`DELETE FROM app_meta`).run()
    recordKeySightings(sqlite, env, daysAgo(45))
    const due = rotationReminders(sqlite, env, NOW)
    expect(due).toHaveLength(1)
    expect(due[0]).toMatchObject({ key: 'DEEPSEEK_API_KEY', days_old: 45 })
  })

  it('a rotated key restarts the clock', () => {
    const env = { DEEPSEEK_API_KEY: 'sk-old-key' } as NodeJS.ProcessEnv
    recordKeySightings(sqlite, env, daysAgo(60))
    expect(rotationReminders(sqlite, env, NOW)).toHaveLength(1)

    const rotated = { DEEPSEEK_API_KEY: 'sk-new-key' } as NodeJS.ProcessEnv
    recordKeySightings(sqlite, rotated, NOW)
    expect(rotationReminders(sqlite, rotated, NOW)).toEqual([])
  })

  it('an unchanged sighting never resets first_seen', () => {
    const env = { API_AUTH_TOKEN: 'token-abc' } as NodeJS.ProcessEnv
    recordKeySightings(sqlite, env, daysAgo(40))
    recordKeySightings(sqlite, env, NOW) // e.g. server restarted today
    expect(rotationReminders(sqlite, env, NOW)).toHaveLength(1)
  })

  it('surfaces overdue keys in /health', async () => {
    // buildServer recorded API_AUTH_TOKEN at construction; backdate it
    const row = sqlite
      .prepare(`SELECT value FROM app_meta WHERE key = 'key_rotation:API_AUTH_TOKEN'`)
      .get() as { value: string }
    const stored = JSON.parse(row.value) as { hash: string; first_seen: string }
    sqlite
      .prepare(`UPDATE app_meta SET value = ? WHERE key = 'key_rotation:API_AUTH_TOKEN'`)
      .run(JSON.stringify({ ...stored, first_seen: daysAgo(90).toISOString() }))

    const res = await app.inject({ method: 'GET', url: '/health', headers: AUTH })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { key_rotation_due: { key: string; days_old: number }[] }
    const tokenReminder = body.key_rotation_due.find((r) => r.key === 'API_AUTH_TOKEN')
    expect(tokenReminder).toBeDefined()
    expect(tokenReminder!.days_old).toBeGreaterThanOrEqual(89)
  })
})
