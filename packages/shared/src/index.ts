import { z } from 'zod'

// ---------- Master profile ----------
// Every bullet/entry carries a stable fact_id: the provenance backbone.
// Generation output must reference these ids; unresolvable references are rejected.

export const JD_TEXT_MAX = 4000

export const ContactSchema = z.object({
  full_name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().default(''),
  location: z.string().default(''),
})

export const FactBulletSchema = z.object({
  fact_id: z.string().min(1),
  text: z.string().min(1),
})

export const ExperienceEntrySchema = z.object({
  fact_id: z.string().min(1),
  organisation: z.string().min(1),
  role: z.string().default(''),
  start_date: z.string().default(''),
  end_date: z.string().default(''),
  is_current: z.boolean().default(false),
  location: z.string().default(''),
  bullets: z.array(FactBulletSchema).default([]),
})

const sectionBase = {
  id: z.string().min(1),
  order: z.number().int().nonnegative(),
  title: z.string().min(1),
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

export type JobStatus = z.infer<typeof JobStatusSchema>
export type SourceBoard = z.infer<typeof SourceBoardSchema>
export type JobInput = z.infer<typeof JobInputSchema>

// ---------- Documents ----------

export const DocumentTypeSchema = z.enum(['resume', 'cover_letter'])
export type DocumentType = z.infer<typeof DocumentTypeSchema>
