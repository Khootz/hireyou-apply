import fs from 'node:fs'
import path from 'node:path'
import { fetch as undiciFetch, ProxyAgent } from 'undici'
import { z } from 'zod'

// DeepSeek chat client with schema-validated JSON output and three modes:
//   live   — real API call (default outside tests)
//   replay — read tests/fixtures/llm/<fixture>.json (default under Vitest)
//   record — real call, then persist the fixture for future replays
// Every call validates against a zod schema; one retry with the validation
// error appended, then fail loudly. Never returns unvalidated output.

export type LlmTier = 'cheap' | 'strong'
export type LlmMode = 'live' | 'replay' | 'record'

const FIXTURE_DIR = () => path.resolve(process.cwd(), 'tests/fixtures/llm')

export class LlmError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'LlmError'
  }
}

export function resolveMode(): LlmMode {
  const explicit = process.env.LLM_MODE
  if (explicit === 'live' || explicit === 'replay' || explicit === 'record') return explicit
  return process.env.VITEST ? 'replay' : 'live'
}

// The dev machine routes ALL outbound traffic through a local proxy
// (HTTP_PROXY/HTTPS_PROXY env vars); Node's fetch ignores those vars, so we
// go through undici with an explicit dispatcher when a proxy is configured.
let cachedDispatcher: ProxyAgent | undefined
function proxyDispatcher(): ProxyAgent | undefined {
  const proxy =
    process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy
  if (!proxy) return undefined
  cachedDispatcher ??= new ProxyAgent(proxy)
  return cachedDispatcher
}

export interface ChatJsonOptions<S extends z.ZodTypeAny> {
  tier: LlmTier
  system: string
  user: string
  schema: S
  /** Fixture name for replay/record modes, e.g. 'm0-smoke' */
  fixture: string
  temperature?: number
}

export async function chatJSON<S extends z.ZodTypeAny>(opts: ChatJsonOptions<S>): Promise<z.infer<S>> {
  const mode = resolveMode()

  if (mode === 'replay') {
    const file = path.join(FIXTURE_DIR(), `${opts.fixture}.json`)
    if (!fs.existsSync(file)) {
      throw new LlmError(`LLM fixture missing: ${file} (run with LLM_MODE=record to create it)`)
    }
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { content: string }
    return validateOrThrow(raw.content, opts.schema, `fixture ${opts.fixture}`)
  }

  const first = await callDeepseek(opts)
  try {
    const parsed = validateOrThrow(first, opts.schema, opts.fixture)
    if (mode === 'record') writeFixture(opts.fixture, first)
    return parsed
  } catch (err) {
    const correction =
      `Your previous reply failed validation: ${(err as Error).message}. ` +
      `Return ONLY the corrected JSON object, nothing else.`
    const second = await callDeepseek(opts, { previous: first, correction })
    const parsed = validateOrThrow(second, opts.schema, opts.fixture)
    if (mode === 'record') writeFixture(opts.fixture, second)
    return parsed
  }
}

function validateOrThrow<S extends z.ZodTypeAny>(content: string, schema: S, label: string): z.infer<S> {
  let json: unknown
  try {
    json = JSON.parse(content)
  } catch {
    throw new LlmError(`${label}: response is not valid JSON`)
  }
  const result = schema.safeParse(json)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new LlmError(`${label}: schema validation failed: ${issues}`)
  }
  return result.data
}

function writeFixture(fixture: string, content: string): void {
  fs.mkdirSync(FIXTURE_DIR(), { recursive: true })
  const file = path.join(FIXTURE_DIR(), `${fixture}.json`)
  fs.writeFileSync(file, JSON.stringify({ recorded_at: new Date().toISOString(), content }, null, 2))
}

async function callDeepseek<S extends z.ZodTypeAny>(
  opts: ChatJsonOptions<S>,
  retry?: { previous: string; correction: string },
): Promise<string> {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) throw new LlmError('DEEPSEEK_API_KEY not set')

  const model =
    opts.tier === 'cheap'
      ? (process.env.MODEL_CHEAP ?? 'deepseek-v4-flash')
      : (process.env.MODEL_STRONG ?? 'deepseek-v4-pro')

  const messages: { role: string; content: string }[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.user },
  ]
  if (retry) {
    messages.push({ role: 'assistant', content: retry.previous })
    messages.push({ role: 'user', content: retry.correction })
  }

  const base = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'
  const res = await undiciFetch(`${base}/chat/completions`, {
    method: 'POST',
    dispatcher: proxyDispatcher(),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: 'json_object' },
      temperature: opts.temperature ?? 0.3,
    }),
  })
  if (!res.ok) {
    throw new LlmError(`DeepSeek HTTP ${res.status}: ${await res.text()}`)
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.length === 0) {
    throw new LlmError('DeepSeek response contained no content')
  }
  return content
}
