import type Database from 'better-sqlite3'
import { z } from 'zod'
import {
  ANSWERABLE_KEYS,
  AnswersSchema,
  CanonicalFieldSchema,
  isPlaceholderOption,
  type AnswerMap,
  type CanonicalField,
} from '@app/shared/autofill'

// One saved answer per canonical field (Simplify-style "application answers"):
// the user answers a common question once, autofill reuses it on every form
// whose field classifies to that canonical. Keys outside ANSWER_QUESTIONS are
// dropped by the schema — sensitive canonicals can never be stored.

export function getAnswers(sqlite: Database.Database): AnswerMap {
  const rows = sqlite.prepare(`SELECT canonical, value FROM application_answers`).all() as {
    canonical: string
    value: string
  }[]
  return AnswersSchema.parse(Object.fromEntries(rows.map((r) => [r.canonical, r.value])))
}

// ---------- harvested option vocabularies ----------
//
// When a scanned form carries a fixed-choice control that classifies to an
// answerable canonical, its REAL option list is stored here — the answers
// page then offers those exact wordings as a dropdown, so the saved answer
// matches the form verbatim instead of hoping prose lines up. Only option
// TEXT is stored (form chrome, not user data); latest scan wins.

export interface AnswerVocabEntry {
  options: string[]
  source_host: string
  updated_at: string
}

// 2 = a real choice; 400 admits full country lists while excluding
// runaway junk (e.g. a university typeahead's thousands of entries)
const MIN_VOCAB_OPTIONS = 2
const MAX_VOCAB_OPTIONS = 400

export function recordAnswerVocab(
  sqlite: Database.Database,
  entries: { canonical: string; options: string[]; source_host: string }[],
): number {
  const insert = sqlite.prepare(
    `INSERT OR REPLACE INTO answer_option_vocab (canonical, options_json, source_host, updated_at) VALUES (?, ?, ?, ?)`,
  )
  const now = new Date().toISOString()
  let stored = 0
  const seen = new Set<string>()
  const tx = sqlite.transaction(() => {
    for (const e of entries) {
      const key = CanonicalFieldSchema.safeParse(e.canonical)
      if (!key.success || !ANSWERABLE_KEYS.has(key.data) || seen.has(key.data)) continue
      const options = [...new Set(e.options.map((o) => o.trim()))].filter((o) => !isPlaceholderOption(o))
      if (options.length < MIN_VOCAB_OPTIONS || options.length > MAX_VOCAB_OPTIONS) continue
      seen.add(key.data)
      insert.run(key.data, JSON.stringify(options), e.source_host.slice(0, 200), now)
      stored++
    }
  })
  tx()
  return stored
}

const VocabRowSchema = z.array(z.string())

export function getAnswerVocab(sqlite: Database.Database): Partial<Record<CanonicalField, AnswerVocabEntry>> {
  const rows = sqlite
    .prepare(`SELECT canonical, options_json, source_host, updated_at FROM answer_option_vocab`)
    .all() as { canonical: string; options_json: string; source_host: string; updated_at: string }[]
  const out: Partial<Record<CanonicalField, AnswerVocabEntry>> = {}
  for (const r of rows) {
    const key = CanonicalFieldSchema.safeParse(r.canonical)
    if (!key.success) continue
    try {
      out[key.data] = {
        options: VocabRowSchema.parse(JSON.parse(r.options_json)),
        source_host: r.source_host,
        updated_at: r.updated_at,
      }
    } catch {
      // unreadable row = absent, never an error
    }
  }
  return out
}

export function saveAnswers(sqlite: Database.Database, input: unknown): AnswerMap {
  // MERGE, never replace: an outdated answers page autosaving its stale
  // state must not wipe keys it doesn't know exist (seen live TWICE — a
  // pre-deploy tab erased gender/location/gpa/… saved minutes earlier).
  // A key explicitly sent blank deletes that one answer; absent keys are
  // untouched.
  const raw = z.record(z.string(), z.string()).parse(input)
  const now = new Date().toISOString()
  const upsert = sqlite.prepare(
    `INSERT OR REPLACE INTO application_answers (canonical, value, updated_at) VALUES (?, ?, ?)`,
  )
  const del = sqlite.prepare(`DELETE FROM application_answers WHERE canonical = ?`)
  const tx = sqlite.transaction(() => {
    for (const [k, v] of Object.entries(raw)) {
      const key = CanonicalFieldSchema.safeParse(k)
      if (!key.success || !ANSWERABLE_KEYS.has(key.data)) continue
      if (v.trim()) upsert.run(key.data, v.trim(), now)
      else del.run(key.data)
    }
  })
  tx()
  return getAnswers(sqlite)
}
