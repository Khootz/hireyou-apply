import { beforeAll, describe, expect, it } from 'vitest'
import { buildServer } from '../src/server'

beforeAll(() => {
  process.env.API_AUTH_TOKEN = 'test-token'
})

describe('API auth + health', () => {
  it('returns 200 with a valid bearer token', async () => {
    const app = buildServer()
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { authorization: 'Bearer test-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'ok' })
  })

  it('returns 401 without a token', async () => {
    const app = buildServer()
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 with a wrong token', async () => {
    const app = buildServer()
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { authorization: 'Bearer nope' },
    })
    expect(res.statusCode).toBe(401)
  })
})
