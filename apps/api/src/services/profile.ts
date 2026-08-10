import crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  emptyProfile,
  type ExperienceEntry,
  type FactBullet,
  type MasterProfile,
  type ProfileSection,
} from '@app/shared'

// fact_ids are the provenance backbone: generation output (M4) must reference
// them, so they are assigned exactly once and never regenerated for existing
// items. Array position is the canonical section order; `order` is rewritten
// to match on every save.

function withFactId<T extends { fact_id: string }>(item: T): T {
  return item.fact_id ? item : { ...item, fact_id: crypto.randomUUID() }
}

function normalizeBullet(b: FactBullet): FactBullet {
  return withFactId(b)
}

function normalizeEntry(e: ExperienceEntry): ExperienceEntry {
  return withFactId({ ...e, bullets: e.bullets.map(normalizeBullet) })
}

function normalizeSection(section: ProfileSection, index: number): ProfileSection {
  const id = section.id || crypto.randomUUID()
  switch (section.type) {
    case 'paragraph':
      return { ...section, id, order: index }
    case 'experience':
      return { ...section, id, order: index, content: { entries: section.content.entries.map(normalizeEntry) } }
    case 'bullets':
      return { ...section, id, order: index, content: { items: section.content.items.map(normalizeBullet) } }
  }
}

export function normalizeProfile(profile: MasterProfile): MasterProfile {
  return {
    contact: profile.contact,
    sections: profile.sections.map(normalizeSection),
  }
}

export function getProfile(sqlite: Database.Database): MasterProfile {
  const row = sqlite
    .prepare(`SELECT contact_json, sections_json FROM master_profile WHERE id = 1`)
    .get() as { contact_json: string; sections_json: string } | undefined
  if (!row) return emptyProfile()
  return {
    contact: JSON.parse(row.contact_json),
    sections: JSON.parse(row.sections_json),
  }
}

export function saveProfile(sqlite: Database.Database, profile: MasterProfile): MasterProfile {
  const normalized = normalizeProfile(profile)
  sqlite
    .prepare(
      `INSERT INTO master_profile (id, contact_json, sections_json, updated_at)
       VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         contact_json = excluded.contact_json,
         sections_json = excluded.sections_json,
         updated_at = excluded.updated_at`,
    )
    .run(JSON.stringify(normalized.contact), JSON.stringify(normalized.sections), new Date().toISOString())
  return normalized
}
