import { useEffect, useRef, useState } from 'react'
import type { ExperienceEntry, FactBullet, MasterProfile, ProfileSection } from '@app/shared'
import { api } from '../api'

// The editor generates ids/fact_ids client-side on creation, so the server's
// backfill never rewrites editor content and autosave responses can be ignored.

type SaveState = 'loading' | 'idle' | 'saving' | 'saved' | 'error'

function newBullet(): FactBullet {
  return { fact_id: crypto.randomUUID(), text: '' }
}

function newEntry(): ExperienceEntry {
  return {
    fact_id: crypto.randomUUID(),
    organisation: '',
    role: '',
    start_date: '',
    end_date: '',
    is_current: false,
    location: '',
    bullets: [newBullet()],
  }
}

function newSection(type: ProfileSection['type']): ProfileSection {
  const base = { id: crypto.randomUUID(), order: 0, title: '' }
  switch (type) {
    case 'paragraph':
      return { ...base, type, content: { text: '' } }
    case 'experience':
      return { ...base, type, content: { entries: [newEntry()] } }
    case 'bullets':
      return { ...base, type, content: { items: [newBullet()] } }
  }
}

const TYPE_LABEL: Record<ProfileSection['type'], string> = {
  paragraph: 'Paragraph',
  experience: 'Experience',
  bullets: 'Bullets',
}

export function ProfilePage() {
  const [profile, setProfile] = useState<MasterProfile | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('loading')
  const dirty = useRef(0)

  useEffect(() => {
    api
      .getProfile()
      .then((p) => {
        setProfile(p)
        setSaveState('idle')
      })
      .catch(() => setSaveState('error'))
  }, [])

  useEffect(() => {
    if (!profile || dirty.current === 0) return
    const timer = setTimeout(async () => {
      setSaveState('saving')
      try {
        await api.saveProfile(profile)
        setSaveState('saved')
      } catch {
        setSaveState('error')
      }
    }, 800)
    return () => clearTimeout(timer)
  }, [profile])

  const edit = (updater: (p: MasterProfile) => MasterProfile) => {
    dirty.current += 1
    setProfile((p) => (p ? updater(p) : p))
  }

  const editSection = (id: string, updater: (s: ProfileSection) => ProfileSection) =>
    edit((p) => ({ ...p, sections: p.sections.map((s) => (s.id === id ? updater(s) : s)) }))

  const moveSection = (index: number, delta: -1 | 1) =>
    edit((p) => {
      const next = [...p.sections]
      const target = index + delta
      if (target < 0 || target >= next.length) return p
      ;[next[index], next[target]] = [next[target], next[index]]
      return { ...p, sections: next }
    })

  const removeSection = (id: string) => edit((p) => ({ ...p, sections: p.sections.filter((s) => s.id !== id) }))

  const addSection = (type: ProfileSection['type']) =>
    edit((p) => ({ ...p, sections: [...p.sections, newSection(type)] }))

  if (!profile) {
    return <div className="mx-auto max-w-3xl px-4 py-16 text-slate-500">{saveState === 'error' ? 'Could not reach the API. Is it running on :3100 with the matching token?' : 'Loading…'}</div>
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">My Resume</h1>
        <SaveBadge state={saveState} />
      </div>

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
        <h2 className="text-xs font-semibold tracking-widest text-slate-500">CONTACT</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(
            [
              ['full_name', 'Full name'],
              ['email', 'Email'],
              ['phone', 'Phone'],
              ['location', 'Location'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block">
              <span className="text-xs text-slate-500">{label}</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={profile.contact[key]}
                onChange={(e) => edit((p) => ({ ...p, contact: { ...p.contact, [key]: e.target.value } }))}
              />
            </label>
          ))}
        </div>
      </section>

      {profile.sections.map((section, i) => (
        <section key={section.id} className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <header className="flex items-center gap-2 px-5 pt-4">
            <div className="flex flex-col">
              <button
                className="text-slate-400 hover:text-slate-700 disabled:opacity-25 leading-none"
                disabled={i === 0}
                onClick={() => moveSection(i, -1)}
                title="Move up"
              >
                ▲
              </button>
              <button
                className="text-slate-400 hover:text-slate-700 disabled:opacity-25 leading-none"
                disabled={i === profile.sections.length - 1}
                onClick={() => moveSection(i, 1)}
                title="Move down"
              >
                ▼
              </button>
            </div>
            <input
              className="flex-1 font-semibold tracking-wide text-slate-900 uppercase text-sm bg-transparent focus:outline-none focus:border-b focus:border-blue-500"
              placeholder="SECTION TITLE"
              value={section.title}
              onChange={(e) => editSection(section.id, (s) => ({ ...s, title: e.target.value }))}
            />
            <span className="text-[11px] rounded-md bg-slate-100 text-slate-500 px-2 py-0.5">{TYPE_LABEL[section.type]}</span>
            <button
              className="text-slate-400 hover:text-red-600 text-lg leading-none"
              title="Delete section"
              onClick={() => {
                if (window.confirm(`Delete section "${section.title || 'Untitled'}"?`)) removeSection(section.id)
              }}
            >
              ×
            </button>
          </header>
          <div className="px-5 pb-5 pt-3">
            {section.type === 'paragraph' && (
              <textarea
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-20 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Write here…"
                value={section.content.text}
                onChange={(e) =>
                  editSection(section.id, (s) =>
                    s.type === 'paragraph' ? { ...s, content: { text: e.target.value } } : s,
                  )
                }
              />
            )}
            {section.type === 'bullets' && (
              <BulletList
                items={section.content.items}
                onChange={(items) =>
                  editSection(section.id, (s) => (s.type === 'bullets' ? { ...s, content: { items } } : s))
                }
              />
            )}
            {section.type === 'experience' && (
              <ExperienceList
                entries={section.content.entries}
                onChange={(entries) =>
                  editSection(section.id, (s) => (s.type === 'experience' ? { ...s, content: { entries } } : s))
                }
              />
            )}
          </div>
        </section>
      ))}

      <div className="flex gap-2">
        {(['paragraph', 'experience', 'bullets'] as const).map((type) => (
          <button
            key={type}
            className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 hover:border-blue-500 hover:text-blue-700"
            onClick={() => addSection(type)}
          >
            + {TYPE_LABEL[type]} section
          </button>
        ))}
      </div>
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

function BulletList({ items, onChange }: { items: FactBullet[]; onChange: (items: FactBullet[]) => void }) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={item.fact_id} className="flex items-center gap-2">
          <span className="text-slate-400">•</span>
          <input
            className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={item.text}
            onChange={(e) => onChange(items.map((b, j) => (j === i ? { ...b, text: e.target.value } : b)))}
          />
          <button
            className="text-slate-400 hover:text-red-600"
            title="Remove"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button className="text-sm text-blue-700 hover:underline" onClick={() => onChange([...items, newBullet()])}>
        + Add item
      </button>
    </div>
  )
}

function ExperienceList({
  entries,
  onChange,
}: {
  entries: ExperienceEntry[]
  onChange: (entries: ExperienceEntry[]) => void
}) {
  const update = (i: number, patch: Partial<ExperienceEntry>) =>
    onChange(entries.map((e, j) => (j === i ? { ...e, ...patch } : e)))

  return (
    <div className="space-y-4">
      {entries.map((entry, i) => (
        <div key={entry.fact_id} className="rounded-lg border border-slate-200 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Organisation" value={entry.organisation} onChange={(v) => update(i, { organisation: v })} />
            <Field label="Role" value={entry.role} onChange={(v) => update(i, { role: v })} />
            <Field label="Start date" value={entry.start_date} onChange={(v) => update(i, { start_date: v })} placeholder="2024-06" />
            <Field
              label="End date"
              value={entry.end_date}
              onChange={(v) => update(i, { end_date: v })}
              placeholder="2024-08"
              disabled={entry.is_current}
            />
            <Field label="Location" value={entry.location} onChange={(v) => update(i, { location: v })} />
            <label className="flex items-end gap-2 pb-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={entry.is_current}
                onChange={(e) => update(i, { is_current: e.target.checked, end_date: e.target.checked ? '' : entry.end_date })}
              />
              Current position
            </label>
          </div>
          <BulletList items={entry.bullets} onChange={(bullets) => update(i, { bullets })} />
          <button
            className="text-sm text-slate-400 hover:text-red-600"
            onClick={() => onChange(entries.filter((_, j) => j !== i))}
          >
            Remove entry
          </button>
        </div>
      ))}
      <button className="text-sm text-blue-700 hover:underline" onClick={() => onChange([...entries, newEntry()])}>
        + Add entry
      </button>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}
