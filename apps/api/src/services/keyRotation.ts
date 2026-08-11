import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'

// M9: secrets pasted into chats/scripts during the build must eventually be
// rotated (PLAN §10.3). app_meta stores sha256(secret) + first-seen date —
// NEVER the secret itself. A changed hash means the key was rotated, so the
// clock restarts silently; an unchanged hash past the threshold nags.

const TRACKED_KEYS = ['DEEPSEEK_API_KEY', 'SMTP_APP_PASSWORD', 'API_AUTH_TOKEN'] as const
const DEFAULT_REMIND_AFTER_DAYS = 30

export interface RotationReminder {
  key: string
  first_seen: string
  days_old: number
}

const metaKey = (name: string) => `key_rotation:${name}`
const hashOf = (value: string) => createHash('sha256').update(value).digest('hex')

export function recordKeySightings(
  sqlite: Database.Database,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): void {
  const read = sqlite.prepare(`SELECT value FROM app_meta WHERE key = ?`)
  const write = sqlite.prepare(`INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)`)
  for (const name of TRACKED_KEYS) {
    const secret = env[name]
    if (!secret) continue
    const hash = hashOf(secret)
    const row = read.get(metaKey(name)) as { value: string } | undefined
    let unchanged = false
    if (row) {
      try {
        unchanged = (JSON.parse(row.value) as { hash?: string }).hash === hash
      } catch {
        // unreadable row → rewrite below
      }
    }
    if (!unchanged) write.run(metaKey(name), JSON.stringify({ hash, first_seen: now.toISOString() }))
  }
}

export function rotationReminders(
  sqlite: Database.Database,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): RotationReminder[] {
  const remindAfter = Number(env.KEY_ROTATION_REMIND_DAYS ?? DEFAULT_REMIND_AFTER_DAYS)
  const read = sqlite.prepare(`SELECT value FROM app_meta WHERE key = ?`)
  const due: RotationReminder[] = []
  for (const name of TRACKED_KEYS) {
    if (!env[name]) continue
    const row = read.get(metaKey(name)) as { value: string } | undefined
    if (!row) continue
    try {
      const { first_seen } = JSON.parse(row.value) as { first_seen: string }
      const days_old = Math.floor((now.getTime() - new Date(first_seen).getTime()) / 86_400_000)
      if (days_old >= remindAfter) due.push({ key: name, first_seen, days_old })
    } catch {
      // unreadable row = no reminder; the next sighting rewrites it
    }
  }
  return due
}
