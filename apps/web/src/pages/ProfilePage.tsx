import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ExperienceEntry, FactBullet, MasterProfile, ProfileSection } from '@app/shared'
import { api, profilePdfMeta, profilePdfUrl, type CvParseResponse } from '../api'

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

// Custom pointer-based section drag: the list collapses to compact rows while
// dragging so the whole order is visible, a pill follows the cursor, and a
// ghost row marks the drop slot. `from` is the section's original index;
// the drop index is measured against the list *without* the dragged item.
interface SectionDrag {
  from: number
  x: number
  y: number
  active: boolean
}

export function ProfilePage() {
  const [profile, setProfile] = useState<MasterProfile | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('loading')
  const [parseResult, setParseResult] = useState<CvParseResponse | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [pdfVersion, setPdfVersion] = useState(1)
  const [pages, setPages] = useState<number | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const dirty = useRef(0)
  const [drag, setDrag] = useState<SectionDrag | null>(null)
  const [overIndex, setOverIndex] = useState(0)
  const dragRef = useRef<SectionDrag | null>(null)
  const overRef = useRef(0)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])

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
        setPdfVersion((v) => v + 1) // refresh the live preview
      } catch {
        setSaveState('error')
      }
    }, 800)
    return () => clearTimeout(timer)
  }, [profile])

  useEffect(() => {
    profilePdfMeta()
      .then((m) => setPages(m.pages))
      .catch(() => setPages(null))
  }, [pdfVersion])

  const edit = (updater: (p: MasterProfile) => MasterProfile) => {
    dirty.current += 1
    setProfile((p) => (p ? updater(p) : p))
  }

  const editSection = (id: string, updater: (s: ProfileSection) => ProfileSection) =>
    edit((p) => ({ ...p, sections: p.sections.map((s) => (s.id === id ? updater(s) : s)) }))

  // `to` is the insertion index in the list with the dragged item removed.
  const moveSectionTo = (from: number, to: number) =>
    edit((p) => {
      if (from === to || from < 0 || to < 0 || from >= p.sections.length || to >= p.sections.length) return p
      const next = [...p.sections]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return { ...p, sections: next }
    })

  const beginDrag = (i: number) => (e: ReactPointerEvent) => {
    e.preventDefault()
    const start: SectionDrag = { from: i, x: e.clientX, y: e.clientY, active: false }
    dragRef.current = start
    overRef.current = i
    setDrag(start)
    setOverIndex(i)
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      // 5px threshold so a plain click on the grip doesn't collapse the list
      if (!d.active && Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < 5) return
      const next: SectionDrag = { from: d.from, x: ev.clientX, y: ev.clientY, active: true }
      dragRef.current = next
      setDrag(next)
      let idx = 0
      for (const row of rowRefs.current) {
        if (!row) continue
        const r = row.getBoundingClientRect()
        if (ev.clientY > r.top + r.height / 2) idx++
      }
      overRef.current = idx
      setOverIndex(idx)
      if (ev.clientY < 90) window.scrollBy(0, -16)
      else if (ev.clientY > window.innerHeight - 90) window.scrollBy(0, 16)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (d?.active) moveSectionTo(d.from, overRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const removeSection = (id: string) => edit((p) => ({ ...p, sections: p.sections.filter((s) => s.id !== id) }))

  const addSection = (type: ProfileSection['type']) =>
    edit((p) => ({ ...p, sections: [...p.sections, newSection(type)] }))

  if (!profile) {
    return <div className="mx-auto max-w-3xl px-4 py-16 text-slate-500">{saveState === 'error' ? 'Could not reach the API. Is it running on :3100 with the matching token?' : 'Loading…'}</div>
  }

  const onCvUpload = async (file: File) => {
    setParsing(true)
    setParseError('')
    try {
      setParseResult(await api.parseCv(file))
    } catch (err) {
      setParseError((err as Error).message)
    } finally {
      setParsing(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const applyDraft = (contact: boolean, sectionIdx: Set<number>) => {
    if (!parseResult) return
    const draft = parseResult.draft
    edit((p) => ({
      contact: contact
        ? {
            full_name: draft.contact.full_name || p.contact.full_name,
            email: draft.contact.email || p.contact.email,
            phone: draft.contact.phone || p.contact.phone,
            location: draft.contact.location || p.contact.location,
          }
        : p.contact,
      sections: draft.sections.filter((_, i) => sectionIdx.has(i)),
    }))
    setParseResult(null)
  }

  return (
    <div className={`mx-auto max-w-7xl px-4 py-8 space-y-6 ${drag?.active ? 'select-none cursor-grabbing' : ''}`}>
      {drag?.active && (
        <div className="fixed z-50 pointer-events-none w-80 rotate-1" style={{ left: drag.x - 24, top: drag.y - 22 }}>
          <SectionPill section={profile.sections[drag.from]} floating />
        </div>
      )}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">My Resume</h1>
        <div className="flex items-center gap-3">
          <SaveBadge state={saveState} />
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onCvUpload(e.target.files[0])}
          />
          <button
            className="rounded-lg bg-blue-700 text-white text-sm px-3 py-2 hover:bg-blue-800 disabled:opacity-50"
            disabled={parsing}
            onClick={() => fileInput.current?.click()}
          >
            {parsing ? 'Parsing CV…' : 'Upload CV to pre-fill'}
          </button>
        </div>
      </div>
      {parseError && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2">{parseError}</div>}
      {parseResult && (
        <CvReviewDialog
          result={parseResult}
          hasExistingSections={profile.sections.length > 0}
          onCancel={() => setParseResult(null)}
          onApply={applyDraft}
        />
      )}

      <div className="lg:grid lg:grid-cols-2 lg:gap-6 items-start space-y-6 lg:space-y-0">
      <div className="space-y-6">
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

      {drag?.active
        ? (() => {
            const dragged = profile.sections[drag.from]
            const others = profile.sections.filter((_, idx) => idx !== drag.from)
            rowRefs.current = []
            const rows: JSX.Element[] = []
            others.forEach((s, j) => {
              if (j === overIndex) rows.push(<SectionPill key="__ghost" section={dragged} ghost />)
              rows.push(
                <div
                  key={s.id}
                  ref={(el) => {
                    rowRefs.current[j] = el
                  }}
                >
                  <SectionPill section={s} />
                </div>,
              )
            })
            if (overIndex >= others.length) rows.push(<SectionPill key="__ghost" section={dragged} ghost />)
            return rows
          })()
        : profile.sections.map((section, i) => (
        <section
          key={section.id}
          className="bg-white rounded-xl border border-slate-200 shadow-sm"
        >
          <header className="flex items-center gap-2 px-5 pt-4">
            <span
              className="cursor-grab touch-none text-slate-300 hover:text-slate-500 select-none text-lg leading-none"
              title="Drag to reorder"
              onPointerDown={beginDrag(i)}
            >
              ⠿
            </span>
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

      <div className="lg:sticky lg:top-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100">
            <span className="text-xs font-semibold tracking-widest text-slate-500">PREVIEW</span>
            <span className="text-xs text-slate-400">
              {pages !== null ? `${pages} page${pages === 1 ? '' : 's'}` : ''}
              <a className="ml-3 text-blue-700 hover:underline" href={profilePdfUrl(pdfVersion)} target="_blank" rel="noreferrer">
                ⬇ PDF
              </a>
            </span>
          </div>
          <iframe title="Resume preview" src={profilePdfUrl(pdfVersion)} className="w-full h-[78vh] bg-slate-100" />
        </div>
      </div>
      </div>
    </div>
  )
}

function CvReviewDialog({
  result,
  hasExistingSections,
  onCancel,
  onApply,
}: {
  result: CvParseResponse
  hasExistingSections: boolean
  onCancel: () => void
  onApply: (contact: boolean, sectionIdx: Set<number>) => void
}) {
  const [useContact, setUseContact] = useState(true)
  const [selected, setSelected] = useState<Set<number>>(new Set(result.draft.sections.map((_, i) => i)))

  const toggle = (i: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  const summarize = (s: ProfileSection): string => {
    switch (s.type) {
      case 'paragraph':
        return s.content.text.slice(0, 80)
      case 'experience':
        return s.content.entries.map((e) => e.organisation || e.role).filter(Boolean).join(', ').slice(0, 80)
      case 'bullets':
        return `${s.content.items.length} items`
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6 space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Review parsed CV</h2>
        <p className="text-sm text-slate-500">
          Pick what to bring into your profile. Nothing is applied until you confirm.
          {hasExistingSections && (
            <span className="block mt-1 text-amber-700">⚠ Applying replaces your current sections with the selected ones.</span>
          )}
        </p>
        {result.warnings.length > 0 && (
          <div className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2">{result.warnings.join('; ')}</div>
        )}
        <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3">
          <input type="checkbox" checked={useContact} onChange={(e) => setUseContact(e.target.checked)} />
          <span className="text-sm">
            <span className="font-medium text-slate-900">Contact</span>
            <span className="block text-slate-500">
              {[result.draft.contact.full_name, result.draft.contact.email, result.draft.contact.phone]
                .filter(Boolean)
                .join(' · ') || '(none found)'}
            </span>
          </span>
        </label>
        {result.draft.sections.map((s, i) => (
          <label key={i} className="flex items-start gap-2 rounded-lg border border-slate-200 p-3">
            <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
            <span className="text-sm">
              <span className="font-medium text-slate-900">{s.title || 'Untitled'}</span>
              <span className="ml-2 text-[11px] rounded bg-slate-100 text-slate-500 px-1.5 py-0.5">{TYPE_LABEL[s.type]}</span>
              <span className="block text-slate-500">{summarize(s)}</span>
            </span>
          </label>
        ))}
        <div className="flex justify-end gap-2 pt-2">
          <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="rounded-lg bg-blue-700 text-white px-4 py-2 text-sm hover:bg-blue-800"
            onClick={() => onApply(useContact, selected)}
          >
            Apply {selected.size} section{selected.size === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SectionPill({ section, ghost, floating }: { section: ProfileSection; ghost?: boolean; floating?: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-xl border bg-white px-5 py-4 ${
        ghost ? 'border-dashed border-blue-400 bg-blue-50 opacity-50' : floating ? 'border-slate-200 shadow-xl' : 'border-slate-200 shadow-sm'
      }`}
    >
      <span className="text-slate-300 text-lg leading-none select-none">⠿</span>
      <span className="flex-1 min-w-0 truncate font-semibold tracking-wide text-slate-900 uppercase text-sm">
        {section.title || 'Untitled'}
      </span>
      <span className="text-[11px] rounded-md bg-slate-100 text-slate-500 px-2 py-0.5">{TYPE_LABEL[section.type]}</span>
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
