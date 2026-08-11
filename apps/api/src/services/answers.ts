import type Database from 'better-sqlite3'
import { AnswersSchema, type AnswerMap } from '@app/shared/autofill'

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

export function saveAnswers(sqlite: Database.Database, input: unknown): AnswerMap {
  const answers = AnswersSchema.parse(input)
  const now = new Date().toISOString()
  const tx = sqlite.transaction(() => {
    // full replace: an emptied field on the page means "forget that answer"
    sqlite.prepare(`DELETE FROM application_answers`).run()
    const insert = sqlite.prepare(
      `INSERT INTO application_answers (canonical, value, updated_at) VALUES (?, ?, ?)`,
    )
    for (const [canonical, value] of Object.entries(answers)) insert.run(canonical, value, now)
  })
  tx()
  return answers
}
