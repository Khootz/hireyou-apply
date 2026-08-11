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

// Provider failures (network, auth, rate limit, outage) are NOT validation
// failures: they must surface as "DeepSeek is down/misconfigured", never be
// retried as if the model answered badly, and never fake a degraded success.
export class LlmProviderError extends LlmError {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'LlmProviderError'
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
    if (err instanceof LlmProviderError) throw err
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
  let res: Awaited<ReturnType<typeof undiciFetch>>
  try {
    res = await undiciFetch(`${base}/chat/completions`, {
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
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause
    const detail = cause?.code ?? (err as Error).message
    throw new LlmProviderError(`DeepSeek unreachable (${detail}) — check network/proxy, not your data`)
  }
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200)
    const reason =
      res.status === 401 || res.status === 403
        ? 'authentication failed — check DEEPSEEK_API_KEY'
        : res.status === 429
          ? 'rate limited — wait and retry'
          : res.status >= 500
            ? "provider outage on DeepSeek's side"
            : 'request rejected'
    throw new LlmProviderError(`DeepSeek HTTP ${res.status} (${reason}): ${body}`, res.status)
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.length === 0) {
    throw new LlmProviderError('DeepSeek returned an empty response (provider issue, not your data)')
  }
  return content
}
