import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { MasterProfile } from '@app/shared'
import { openDb } from '../src/db'
import { buildServer } from '../src/server'

const AUTH = { authorization: 'Bearer test-token' }

let app: FastifyInstance

beforeAll(() => {
  process.env.API_AUTH_TOKEN = 'test-token'
})

beforeEach(() => {
  const { sqlite } = openDb(':memory:')
  app = buildServer({ sqlite })
})

function sampleProfile(): MasterProfile {
  return {
    contact: { full_name: 'Khoo Thien Zhi', email: 'tzkhoo@connect.ust.hk', phone: '+852 0000 0000', location: 'Hong Kong' },
    sections: [
      {
        id: 'sec-summary', order: 0, type: 'paragraph', title: 'Professional Summary',
        content: { text: 'Final-year Computer Engineering student at HKUST.' },
      },
      {
        id: 'sec-exp', order: 1, type: 'experience', title: 'Experience',
        content: {
          entries: [{
            fact_id: 'fact-wonder', organisation: 'Wonder/Bindo Labs', role: 'Strategy & Products Intern',
            start_date: '2024-06', end_date: '2024-08', is_current: false, location: 'Hong Kong',
            bullets: [
              { fact_id: 'fact-prospect', text: 'Prospected over 2,000 clients in HK and SEA.' },
              { fact_id: 'fact-close', text: 'Closed 20 key clients via automated lead-gen pipeline.' },
            ],
          }],
        },
      },
      {
        id: 'sec-skills', order: 2, type: 'bullets', title: 'Skills & Interests',
        content: { items: [{ fact_id: 'fact-python', text: 'Python' }, { fact_id: 'fact-ts', text: 'TypeScript' }] },
      },
    ],
  }
}

describe('profile API', () => {
  it('returns an empty profile before anything is saved', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/profile', headers: AUTH })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      contact: { full_name: '', email: '', phone: '', location: '' },
      sections: [],
    })
  })

  it('round-trips a full profile (PUT then GET deep-equals)', async () => {
    const profile = sampleProfile()
    const put = await app.inject({ method: 'PUT', url: '/api/profile', headers: AUTH, payload: profile })
    expect(put.statusCode).toBe(200)

    const get = await app.inject({ method: 'GET', url: '/api/profile', headers: AUTH })
    expect(get.json()).toEqual(put.json())
    expect(get.json()).toEqual(profile)
  })

  it('rejects an invalid profile with 400 and named issues', async () => {
    const bad = { contact: { email: 'not-an-email' }, sections: [{ id: 'x', order: 0, type: 'table', title: 'Nope', content: {} }] }
    const res = await app.inject({ method: 'PUT', url: '/api/profile', headers: AUTH, payload: bad })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('validation_failed')
    expect(res.json().issues.length).toBeGreaterThan(0)
  })

  it('accepts a draft profile with empty contact and empty texts', async () => {
    const draft = {
      contact: { full_name: '', email: '', phone: '', location: '' },
      sections: [{ id: '', order: 0, type: 'paragraph', title: '', content: { text: '' } }],
    }
    const res = await app.inject({ method: 'PUT', url: '/api/profile', headers: AUTH, payload: draft })
    expect(res.statusCode).toBe(200)
  })

  it('backfills missing ids and fact_ids on save', async () => {
    const profile = sampleProfile()
    profile.sections[0].id = ''
    const exp = profile.sections[1]
    if (exp.type === 'experience') {
      exp.content.entries[0].fact_id = ''
      exp.content.entries[0].bullets[0].fact_id = ''
    }

    const res = await app.inject({ method: 'PUT', url: '/api/profile', headers: AUTH, payload: profile })
    const saved = res.json() as MasterProfile
    expect(saved.sections[0].id).not.toBe('')
    const savedExp = saved.sections[1]
    if (savedExp.type !== 'experience') throw new Error('expected experience section')
    expect(savedExp.content.entries[0].fact_id).not.toBe('')
    expect(savedExp.content.entries[0].bullets[0].fact_id).not.toBe('')
    // untouched ids survive exactly
    expect(savedExp.content.entries[0].bullets[1].fact_id).toBe('fact-close')
  })

  it('keeps fact_ids stable across edits (provenance invariant)', async () => {
    const first = await app.inject({ method: 'PUT', url: '/api/profile', headers: AUTH, payload: sampleProfile() })
    const v1 = first.json() as MasterProfile

    // edit a bullet's text, re-save the whole profile (autosave behaviour)
    const edited = structuredClone(v1)
    const exp = edited.sections[1]
    if (exp.type !== 'experience') throw new Error('expected experience section')
    exp.content.entries[0].bullets[0].text = 'Prospected 2,000+ clients across Hong Kong and Southeast Asia.'

    const second = await app.inject({ method: 'PUT', url: '/api/profile', headers: AUTH, payload: edited })
    const v2 = second.json() as MasterProfile

    const ids = (p: MasterProfile) =>
      p.sections.flatMap((s) =>
        s.type === 'experience'
          ? s.content.entries.flatMap((e) => [e.fact_id, ...e.bullets.map((b) => b.fact_id)])
          : s.type === 'bullets'
            ? s.content.items.map((b) => b.fact_id)
            : [],
      )
    expect(ids(v2)).toEqual(ids(v1))
  })

  it('persists reordered sections and rewrites order to match array position', async () => {
    await app.inject({ method: 'PUT', url: '/api/profile', headers: AUTH, payload: sampleProfile() })

    const reordered = sampleProfile()
    reordered.sections = [reordered.sections[2], reordered.sections[0], reordered.sections[1]]
    const res = await app.inject({ method: 'PUT', url: '/api/profile', headers: AUTH, payload: reordered })
    const saved = res.json() as MasterProfile

    expect(saved.sections.map((s) => s.id)).toEqual(['sec-skills', 'sec-summary', 'sec-exp'])
    expect(saved.sections.map((s) => s.order)).toEqual([0, 1, 2])

    const get = await app.inject({ method: 'GET', url: '/api/profile', headers: AUTH })
    expect((get.json() as MasterProfile).sections.map((s) => s.id)).toEqual(['sec-skills', 'sec-summary', 'sec-exp'])
  })

  it('requires auth on profile routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/profile' })
    expect(res.statusCode).toBe(401)
  })
})
