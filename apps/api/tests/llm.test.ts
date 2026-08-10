import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { chatJSON, resolveMode } from '../src/llm/client'

const SmokeSchema = z.object({ ok: z.boolean(), reply: z.string() })

afterEach(() => {
  delete process.env.LLM_MODE
})

describe('LLM client', () => {
  it('defaults to replay mode under Vitest', () => {
    expect(resolveMode()).toBe('replay')
  })

  it('replays a recorded fixture and validates it against the schema', async () => {
    const out = await chatJSON({
      tier: 'cheap',
      system: 'You are a JSON echo service.',
      user: 'Reply with {"ok": true, "reply": "harness operational"}',
      schema: SmokeSchema,
      fixture: 'm0-smoke',
    })
    expect(out.ok).toBe(true)
    expect(out.reply).toContain('harness')
  })

  it('throws a useful error when the fixture is missing', async () => {
    await expect(
      chatJSON({
        tier: 'cheap',
        system: 's',
        user: 'u',
        schema: SmokeSchema,
        fixture: 'does-not-exist',
      }),
    ).rejects.toThrow(/fixture missing/i)
  })

  // Costs a fraction of a cent; run explicitly with LIVE_LLM=1.
  it.runIf(process.env.LIVE_LLM === '1')('live: DeepSeek returns schema-valid JSON', async () => {
    process.env.LLM_MODE = 'live'
    const out = await chatJSON({
      tier: 'cheap',
      system: 'You are a JSON echo service. Reply with exactly the JSON the user asks for.',
      user: 'Reply with {"ok": true, "reply": "live roundtrip"}',
      schema: SmokeSchema,
      fixture: 'm0-live-smoke',
    })
    expect(out.ok).toBe(true)
  }, 30_000)
})
