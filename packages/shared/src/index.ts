import { z } from 'zod'

// ---------- Master profile ----------
// Every bullet/entry carries a stable fact_id: the provenance backbone.
// Generation output must reference these ids; unresolvable references are rejected.

export const JD_TEXT_MAX = 4000

// Draft-friendly by design: a student's autosave must never be rejected for
// incompleteness. Completeness is enforced at generation time (M4), not here.
// Empty id/fact_id means "not yet assigned" — the API backfills them on save.

export const ContactSchema = z.object({
  full_name: z.string().default(''),
  email: z.union([z.string().email(), z.literal('')]).default(''),
  phone: z.string().default(''),
  location: z.string().default(''),
})

export const FactBulletSchema = z.object({
  fact_id: z.string().default(''),
  text: z.string().default(''),
})

export const ExperienceEntrySchema = z.object({
  fact_id: z.string().default(''),
  organisation: z.string().default(''),
  role: z.string().default(''),
  start_date: z.string().default(''),
  end_date: z.string().default(''),
  is_current: z.boolean().default(false),
  location: z.string().default(''),
  bullets: z.array(FactBulletSchema).default([]),
})

const sectionBase = {
  id: z.string().default(''),
  order: z.number().int().nonnegative().default(0),
  title: z.string().default(''),
}

export const ProfileSectionSchema = z.discriminatedUnion('type', [
  z.object({ ...sectionBase, type: z.literal('paragraph'), content: z.object({ text: z.string() }) }),
  z.object({ ...sectionBase, type: z.literal('experience'), content: z.object({ entries: z.array(ExperienceEntrySchema) }) }),
  z.object({ ...sectionBase, type: z.literal('bullets'), content: z.object({ items: z.array(FactBulletSchema) }) }),
])

export const MasterProfileSchema = z.object({
  contact: ContactSchema,
  sections: z.array(ProfileSectionSchema),
})

export type Contact = z.infer<typeof ContactSchema>
export type FactBullet = z.infer<typeof FactBulletSchema>
export type ExperienceEntry = z.infer<typeof ExperienceEntrySchema>
export type ProfileSection = z.infer<typeof ProfileSectionSchema>
export type MasterProfile = z.infer<typeof MasterProfileSchema>

export function emptyProfile(): MasterProfile {
  return {
    contact: { full_name: '', email: '', phone: '', location: '' },
    sections: [],
  }
}

// ---------- Jobs ----------

export const JobStatusSchema = z.enum(['saved', 'applied', 'interviewing', 'offered', 'rejected'])
export const SourceBoardSchema = z.enum(['hkust', 'jobsdb', 'ctgoodjobs', 'manual'])

export const JobInputSchema = z.object({
  title: z.string().min(1),
  company: z.string().min(1),
  location: z.string().default(''),
  source_url: z.string().default(''),
  source_board: SourceBoardSchema.default('manual'),
  jd_text: z.string().max(JD_TEXT_MAX).default(''),
  apply_email: z.string().email().nullable().default(null),
  deadline: z.string().default(''),
  status: JobStatusSchema.default('saved'),
  notes: z.string().default(''),
})

export const JobPatchSchema = JobInputSchema.partial()

export const JobRecordSchema = JobInputSchema.extend({
  id: z.string(),
  saved_at: z.string(),
  applied_at: z.string().nullable(),
  status_updated_at: z.string(),
})

export type JobStatus = z.infer<typeof JobStatusSchema>
export type SourceBoard = z.infer<typeof SourceBoardSchema>
export type JobInput = z.infer<typeof JobInputSchema>
export type JobPatch = z.infer<typeof JobPatchSchema>
export type JobRecord = z.infer<typeof JobRecordSchema>

export const JOB_STATUSES: JobStatus[] = ['saved', 'applied', 'interviewing', 'offered', 'rejected']

// ---------- Documents ----------
// Generated document content. Every bullet carries source_fact_id — the
// provenance link back to the master profile that the generation gate
// enforces. Experience org/role/dates are copied server-side from the
// profile, never taken from model output.

export const DocumentTypeSchema = z.enum(['resume', 'cover_letter'])
export type DocumentType = z.infer<typeof DocumentTypeSchema>

export const TailoredBulletSchema = z.object({
  source_fact_id: z.string().min(1),
  text: z.string().min(1),
})

export const ResumeDocumentSchema = z.object({
  kind: z.literal('resume'),
  contact: ContactSchema,
  sections: z.array(
    z.discriminatedUnion('type', [
      z.object({
        type: z.literal('paragraph'),
        title: z.string(),
        source_section_id: z.string(),
        text: z.string(),
      }),
      z.object({
        type: z.literal('experience'),
        title: z.string(),
        source_section_id: z.string(),
        entries: z.array(
          z.object({
            source_fact_id: z.string().min(1),
            organisation: z.string(),
            role: z.string(),
            start_date: z.string(),
            end_date: z.string(),
            is_current: z.boolean(),
            location: z.string(),
            bullets: z.array(TailoredBulletSchema),
          }),
        ),
      }),
      z.object({
        type: z.literal('bullets'),
        title: z.string(),
        source_section_id: z.string(),
        items: z.array(TailoredBulletSchema),
      }),
    ]),
  ),
})

export const CoverLetterDocumentSchema = z.object({
  kind: z.literal('cover_letter'),
  contact: ContactSchema,
  company: z.string(),
  role: z.string(),
  date: z.string(),
  salutation: z.string(),
  paragraphs: z.array(z.string()).min(3).max(3),
  signoff: z.string(),
})

export const DocumentContentSchema = z.discriminatedUnion('kind', [ResumeDocumentSchema, CoverLetterDocumentSchema])

export type ResumeDocument = z.infer<typeof ResumeDocumentSchema>
export type CoverLetterDocument = z.infer<typeof CoverLetterDocumentSchema>
export type DocumentContent = z.infer<typeof DocumentContentSchema>

export const RunKindSchema = z.enum(['tailor_resume', 'cover_letter'])
export const RunStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed'])
export type RunKind = z.infer<typeof RunKindSchema>
export type RunStatus = z.infer<typeof RunStatusSchema>

export interface RunRecord {
  id: string
  job_id: string
  kind: RunKind
  status: RunStatus
  error: string | null
  document_id: string | null
  created_at: string
  finished_at: string | null
}

export interface DocumentRecord {
  id: string
  job_id: string
  type: DocumentType
  version: number
  created_at: string
  content: DocumentContent
}
