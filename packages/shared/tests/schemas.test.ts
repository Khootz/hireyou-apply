import { describe, expect, it } from 'vitest'
import { JD_TEXT_MAX, JobInputSchema, MasterProfileSchema } from '@app/shared'

describe('MasterProfileSchema', () => {
  it('accepts a valid profile with all three section types', () => {
    const profile = {
      contact: { full_name: 'Khoo Thien Zhi', email: 'tzkhoo@connect.ust.hk', phone: '', location: 'Hong Kong' },
      sections: [
        { id: 's1', order: 0, type: 'paragraph', title: 'Professional Summary', content: { text: 'Final-year CE student at HKUST.' } },
        {
          id: 's2', order: 1, type: 'experience', title: 'Experience',
          content: {
            entries: [{
              fact_id: 'f1', organisation: 'Wonder/Bindo Labs', role: 'Intern',
              start_date: '2024-06', end_date: '2024-08', is_current: false, location: 'Hong Kong',
              bullets: [{ fact_id: 'f2', text: 'Prospected over 2,000 clients.' }],
            }],
          },
        },
        { id: 's3', order: 2, type: 'bullets', title: 'Skills & Interests', content: { items: [{ fact_id: 'f3', text: 'Python' }] } },
      ],
    }
    const parsed = MasterProfileSchema.parse(profile)
    expect(parsed.sections).toHaveLength(3)
  })

  it('rejects a section with an unknown type', () => {
    const bad = {
      contact: { full_name: 'X', email: 'x@y.com' },
      sections: [{ id: 's1', order: 0, type: 'table', title: 'Nope', content: {} }],
    }
    expect(MasterProfileSchema.safeParse(bad).success).toBe(false)
  })
})

describe('JobInputSchema', () => {
  it('applies defaults and caps jd_text at 4000 chars', () => {
    const ok = JobInputSchema.parse({ title: 'Quant Researcher Intern', company: 'Jain Global' })
    expect(ok.status).toBe('saved')
    expect(ok.source_board).toBe('manual')

    const tooLong = { title: 'T', company: 'C', jd_text: 'x'.repeat(JD_TEXT_MAX + 1) }
    expect(JobInputSchema.safeParse(tooLong).success).toBe(false)
  })
})
