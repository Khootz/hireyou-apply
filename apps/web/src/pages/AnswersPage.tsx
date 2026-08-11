import { useEffect, useRef, useState } from 'react'
import { ANSWER_QUESTIONS } from '@app/shared/autofill'
import { api } from '../api'

// Simplify-style application answers: the questions every application asks
// but no resume answers. Saved once here, reused by the extension's autofill
// on every form whose field maps to the same canonical question.

type SaveState = 'loading' | 'idle' | 'saving' | 'saved' | 'error'

export function AnswersPage() {
  const [answers, setAnswers] = useState<Record<string, string> | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('loading')
  const dirty = useRef(0)

  useEffect(() => {
    api
      .getAnswers()
      .then((a) => {
        setAnswers(a)
        setSaveState('idle')
      })
      .catch(() => setSaveState('error'))
  }, [])

  useEffect(() => {
    if (!answers || dirty.current === 0) return
    const timer = setTimeout(async () => {
      setSaveState('saving')
      try {
        await api.saveAnswers(answers)
        setSaveState('saved')
      } catch {
        setSaveState('error')
      }
    }, 700)
    return () => clearTimeout(timer)
  }, [answers])

  if (!answers) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-slate-500">
        {saveState === 'error' ? 'Could not reach the API. Is it running on :3100 with the matching token?' : 'Loading…'}
      </div>
    )
  }

  const edit = (key: string, value: string) => {
    dirty.current += 1
    setAnswers((a) => ({ ...a, [key]: value }))
  }

  const answered = ANSWER_QUESTIONS.filter((q) => (answers[q.key] ?? '').trim()).length

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Autofill answers</h1>
          <p className="text-sm text-slate-500 mt-1">
            Answer the questions every application asks — once. The extension fills them on any form automatically.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs rounded-full bg-blue-50 text-blue-700 px-2.5 py-1 font-medium">
            {answered}/{ANSWER_QUESTIONS.length} answered
          </span>
          <SaveBadge state={saveState} />
        </div>
      </div>

      {[...new Set(ANSWER_QUESTIONS.map((q) => q.group))].map((group) => (
        <section key={group}>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">{group}</h2>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
            {ANSWER_QUESTIONS.filter((q) => q.group === group).map((q) => (
              <label key={q.key} className="block px-5 py-4">
                <span className="text-sm font-medium text-slate-900">{q.question}</span>
                <input
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={q.hint}
                  value={answers[q.key] ?? ''}
                  onChange={(e) => edit(q.key, e.target.value)}
                />
              </label>
            ))}
          </div>
        </section>
      ))}

      <p className="text-xs text-slate-400">
        Dropdown questions fill by matching your answer against the option list — write answers exactly as the
        dropdown shows them (e.g. "Hong Kong SAR", not "HK"). Demographic and voluntary-disclosure questions (gender,
        date of birth, ethnicity, criminal history, …) are never asked here and never auto-filled — those stay yours.
      </p>
    </div>
  )
}

function SaveBadge({ state }: { state: SaveState }) {
  const map: Record<SaveState, [string, string]> = {
    loading: ['Loading…', 'text-slate-400'],
    idle: ['', 'text-slate-400'],
    saving: ['Saving…', 'text-slate-400'],
    saved: ['✓ Saved', 'text-green-600'],
    error: ['⚠ Save failed', 'text-red-600'],
  }
  const [label, cls] = map[state]
  return <span className={`text-sm ${cls}`}>{label}</span>
}
