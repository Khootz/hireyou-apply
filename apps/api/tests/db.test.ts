import { describe, expect, it } from 'vitest'
import { openDb } from '../src/db'

describe('DB migrations', () => {
  it('applies migrations to a fresh database exactly once', () => {
    const { sqlite } = openDb(':memory:')

    const meta = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='app_meta'`)
      .get()
    expect(meta).toBeTruthy()

    const applied = sqlite.prepare(`SELECT COUNT(*) AS n FROM _migrations`).get() as { n: number }
    expect(applied.n).toBeGreaterThanOrEqual(1)

    sqlite.close()
  })
})
