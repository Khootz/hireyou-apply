import { z } from 'zod'

// Form-field discovery + tier-1 deterministic classification. Runs in the
// extension content script (live DOM) and in Vitest (fixture HTML). Tier-2
// LLM classification happens server-side (one batched call — see api).
//
// SENSITIVE_DO_NOT_FILL is a hard bucket: demographic/EEO fields never get a
// suggestion, by classification — not by prompt behaviour.

export const CANONICAL_FIELDS = [
  'full_name',
  'first_name',
  'last_name',
  'email',
  'phone',
  'location',
  'linkedin_url',
  'github_url',
  'portfolio_url',
  'current_company',
  'current_title',
  'years_experience',
  'education_institution',
  'degree',
  'graduation_date',
  'highest_education_level',
  'work_authorization',
  'visa_sponsorship_required',
  'notice_period',
  'expected_start_date',
  'willing_to_relocate',
  'languages',
  'salary_expectation',
  'current_salary',
  'cover_letter',
  'why_this_role',
  'why_this_company',
  'additional_info',
  'referral_source',
  'SENSITIVE_DO_NOT_FILL',
  'UNKNOWN',
] as const

export const CanonicalFieldSchema = z.enum(CANONICAL_FIELDS)
export type CanonicalField = z.infer<typeof CanonicalFieldSchema>

export const FieldInfoSchema = z.object({
  selector: z.string(),
  tag: z.string(),
  input_type: z.string().default(''),
  name: z.string().default(''),
  id: z.string().default(''),
  autocomplete: z.string().default(''),
  placeholder: z.string().default(''),
  maxlength: z.number().nullable().default(null),
  required: z.boolean().default(false),
  label: z.string().default(''),
  options: z.array(z.string()).default([]),
})
export type FieldInfo = z.infer<typeof FieldInfoSchema>

export interface FieldSuggestion {
  selector: string
  canonical: CanonicalField
  label: string
  value: string | null
  do_not_fill: boolean
  note?: string
}

// ---------- discovery ----------

function isVisible(el: Element): boolean {
  const style = (el.ownerDocument.defaultView ?? globalThis as unknown as Window).getComputedStyle?.(el)
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false
  return !(el as HTMLElement).hidden
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value)
  return value.replace(/([^\w-])/g, '\\$1')
}

// Required-field markers ("First Name*") are noise for classification.
function cleanLabel(text: string): string {
  return text.replace(/\s*\*\s*$/, '').trim()
}

function resolveLabel(el: Element): string {
  const doc = el.ownerDocument
  const id = el.getAttribute('id')
  if (id) {
    const forLabel = doc.querySelector(`label[for="${cssEscape(id)}"]`)
    if (forLabel?.textContent?.trim()) return cleanLabel(forLabel.textContent)
  }
  const labelledBy = el.getAttribute('aria-labelledby')
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((lid) => doc.getElementById(lid)?.textContent?.trim() ?? '')
      .filter(Boolean)
    if (parts.length) return cleanLabel(parts.join(' '))
  }
  const ariaLabel = el.getAttribute('aria-label')
  if (ariaLabel?.trim()) return cleanLabel(ariaLabel)
  const wrapping = el.closest('label')
  if (wrapping?.textContent?.trim()) return cleanLabel(wrapping.textContent)
  // nearest preceding text within the same container
  let node: Element | null = el
  for (let depth = 0; depth < 3 && node; depth++) {
    let sib = node.previousElementSibling
    while (sib) {
      const text = sib.textContent?.trim()
      if (text && text.length < 200) return cleanLabel(text)
      sib = sib.previousElementSibling
    }
    node = node.parentElement
  }
  return el.getAttribute('placeholder')?.trim() ?? ''
}

// id/name selectors survive a re-render; anonymous elements get tagged with a
// data attribute during discovery (nth-of-type is NOT stable — it counts
// within the parent, not the document, so it silently hit the wrong element).
function stableSelector(el: Element, index: number): string {
  const id = el.getAttribute('id')
  if (id) return `#${cssEscape(id)}`
  const name = el.getAttribute('name')
  if (name) return `${el.tagName.toLowerCase()}[name="${name.replace(/(["\\])/g, '\\$1')}"]`
  el.setAttribute('data-hy-field', String(index))
  return `[data-hy-field="${index}"]`
}

const EXCLUDED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'file', 'password', 'search'])

// A busy listing page (CTgoodjobs: filter sidebars with 100+ checkboxes) can
// out-shout the actual apply form and blow the API's batch cap — the exact
// failure seen live on 2026-08-11 ("Array must contain at most 100"). Text
// entry controls are what autofill can actually fill — checkboxes/radios are
// only ever reported, never ticked — so past the cap, fillable controls keep
// their place and the tick-box noise falls off the end.
export const MAX_AUTOFILL_FIELDS = 100

export function prioritizeFields(fields: FieldInfo[], cap = MAX_AUTOFILL_FIELDS): FieldInfo[] {
  if (fields.length <= cap) return fields
  const isTickBox = (f: FieldInfo) => f.input_type === 'checkbox' || f.input_type === 'radio'
  return [...fields.filter((f) => !isTickBox(f)), ...fields.filter(isTickBox)].slice(0, cap)
}

export function discoverFields(doc: Document): FieldInfo[] {
  const fields: FieldInfo[] = []
  const elements = Array.from(doc.querySelectorAll('input, textarea, select'))
  elements.forEach((el, i) => {
    const tag = el.tagName.toLowerCase()
    const inputType = (el.getAttribute('type') ?? (tag === 'input' ? 'text' : '')).toLowerCase()
    if (tag === 'input' && EXCLUDED_INPUT_TYPES.has(inputType)) return
    if (!isVisible(el)) return
    // screen-reader-hidden / keyboard-unreachable inputs are framework
    // internals (e.g. react-select's proxy "required" input), never real fields
    if (el.getAttribute('aria-hidden') === 'true') return
    if (el.getAttribute('tabindex') === '-1') return
    if (el.hasAttribute('disabled') || el.hasAttribute('readonly')) return
    const maxlengthAttr = el.getAttribute('maxlength')
    const options =
      tag === 'select'
        ? Array.from(el.querySelectorAll('option'))
            .map((o) => o.textContent?.trim() ?? '')
            .filter(Boolean)
        : inputType === 'radio'
          ? [] // radio groups handled per-input; label carries the option
          : []
    fields.push(
      FieldInfoSchema.parse({
        selector: stableSelector(el, i),
        tag,
        input_type: inputType,
        name: el.getAttribute('name') ?? '',
        id: el.getAttribute('id') ?? '',
        autocomplete: el.getAttribute('autocomplete') ?? '',
        placeholder: el.getAttribute('placeholder') ?? '',
        maxlength: maxlengthAttr ? Number(maxlengthAttr) : null,
        required: el.hasAttribute('required'),
        label: resolveLabel(el),
        options,
      }),
    )
  })
  return fields
}

// ---------- tier-1 deterministic classification ----------

const SENSITIVE_PATTERNS =
  /\b(gender|sex\b|race|ethnic|religio|veteran|disabilit|sexual\s*orientation|marital|date\s*of\s*birth|birth\s*date|\bdob\b|nationality|age\b|pregnan|criminal|convict)/i

const RULES: [CanonicalField, RegExp][] = [
  ['email', /\be-?mail\b/i],
  ['phone', /\b(phone|mobile|contact\s*number|tel)\b/i],
  ['full_name', /\b(full\s*name|your\s*name|applicant\s*name)\b/i],
  ['first_name', /\b(first|given)\s*name\b/i],
  ['last_name', /\b(last|family)\s*name|surname\b/i],
  ['linkedin_url', /linked\s*in/i],
  ['github_url', /github/i],
  ['portfolio_url', /\b(portfolio|personal\s*(web)?site|website)\b/i],
  // before current_company: "notice period to your current employer" must not
  // classify as the employer-name field
  ['notice_period', /\bnotice\s*period\b/i],
  ['expected_start_date', /\b(start\s*date|earliest\s+(possible\s+)?(start|commencement)|when\s+can\s+you\s+start|date\s+available|available\s+(from|to\s+start))\b/i],
  ['willing_to_relocate', /\brelocat/i],
  ['languages', /\blanguage/i],
  ['current_company', /\b(current|present)\s*(company|employer)\b/i],
  ['current_title', /\b(current|present|most\s+recent)\s*(role|title|position)\b/i],
  ['years_experience', /\byears?\s*(of)?\s*(work\s*)?experience\b/i],
  // "highest qualification / education level" must win over the degree and
  // institution rules below, which also mention qualification/education words
  ['highest_education_level', /\b(highest\s*(level\s*of\s*)?(education|qualification|degree)|education\s*level)\b/i],
  ['education_institution', /\b(university|school|institution|college)\b/i],
  ['degree', /\b(degree|qualification|major)\b/i],
  ['graduation_date', /\bgraduat/i],
  ['work_authorization', /\b(work\s*authoriz|authoriz.*work|right\s*to\s*work|work\s*permit|legally\s*(entitled|authorized))/i],
  ['visa_sponsorship_required', /\b(visa|sponsor)/i],
  // "current salary" before the generic salary rule — expected vs drawn are
  // different questions with different answers
  ['current_salary', /\b(current|present|latest|last)\s*(monthly\s*|annual\s*)?(salary|pay|compensation)\b/i],
  ['salary_expectation', /\b(salary|compensation|expected\s*pay|remuneration)\b/i],
  ['cover_letter', /\bcover\s*letter\b/i],
  ['why_this_role', /\bwhy\s+(do\s+you\s+want\s+)?(this|the)\s+(role|position|job)\b/i],
  ['why_this_company', /\bwhy\s+(do\s+you\s+want\s+to\s+(work|join)|us|our\s+company)\b/i],
  ['referral_source', /\b(how\s+did\s+you\s+hear|referr(al|ed))\b/i],
  ['location', /\b(location|city|address)\b/i],
]

const AUTOCOMPLETE_MAP: Record<string, CanonicalField> = {
  email: 'email',
  tel: 'phone',
  name: 'full_name',
  'given-name': 'first_name',
  'family-name': 'last_name',
  organization: 'current_company',
  'organization-title': 'current_title',
  'address-level2': 'location',
  bday: 'SENSITIVE_DO_NOT_FILL',
  sex: 'SENSITIVE_DO_NOT_FILL',
}

// ---------- application answers (Simplify-style personalization) ----------
//
// Common application questions that no resume answers ("notice period?",
// "require sponsorship?"). The user answers each ONCE on the web app's
// Autofill answers page; the autofill service then reuses them everywhere a
// field classifies to the matching canonical. Sensitive/EEO canonicals are
// deliberately absent — those stay unanswerable by design.

export interface AnswerQuestion {
  key: CanonicalField
  question: string
  hint: string
}

export const ANSWER_QUESTIONS: AnswerQuestion[] = [
  { key: 'linkedin_url', question: 'LinkedIn profile URL', hint: 'https://linkedin.com/in/…' },
  { key: 'github_url', question: 'GitHub profile URL', hint: 'https://github.com/…' },
  { key: 'portfolio_url', question: 'Personal website / portfolio', hint: 'https://…' },
  { key: 'work_authorization', question: 'Are you authorized to work in your target location?', hint: 'e.g. Yes — Hong Kong resident' },
  { key: 'visa_sponsorship_required', question: 'Will you require visa sponsorship?', hint: 'e.g. No' },
  { key: 'notice_period', question: 'Notice period / availability', hint: 'e.g. Available immediately' },
  { key: 'expected_start_date', question: 'Earliest start date', hint: 'e.g. 1 June 2026 — or Immediately' },
  { key: 'salary_expectation', question: 'Expected salary', hint: 'e.g. HKD 25,000/month' },
  { key: 'current_salary', question: 'Current / most recent salary', hint: 'e.g. HKD 20,000/month — or Prefer not to disclose' },
  { key: 'years_experience', question: 'Years of professional experience', hint: 'e.g. 2' },
  { key: 'highest_education_level', question: 'Highest education level', hint: "e.g. Bachelor's degree (in progress)" },
  { key: 'languages', question: 'Languages you speak', hint: 'e.g. English (fluent), Mandarin (native), Cantonese (conversational)' },
  { key: 'willing_to_relocate', question: 'Willing to relocate?', hint: 'e.g. Yes — open to relocating within Asia' },
  { key: 'referral_source', question: 'How did you hear about us? (default answer)', hint: 'e.g. LinkedIn' },
]

export const ANSWERABLE_KEYS = new Set<CanonicalField>(ANSWER_QUESTIONS.map((q) => q.key))

export const AnswersSchema = z.record(z.string(), z.string()).transform((rec) => {
  const out: Partial<Record<CanonicalField, string>> = {}
  for (const [k, v] of Object.entries(rec)) {
    const key = CanonicalFieldSchema.safeParse(k)
    if (key.success && ANSWERABLE_KEYS.has(key.data) && v.trim()) out[key.data] = v.trim()
  }
  return out
})
export type AnswerMap = z.infer<typeof AnswersSchema>

// ---------- fill engine (generation half of the fill→verify loop) ----------
//
// Runs in the extension content script against the live DOM and in Vitest
// against JSDOM fixtures, so the exact code the demo relies on is the code
// the eval measures. Fills are verified by reading the value back; the
// content script re-verifies after a delay and retries anything a framework
// reverted. Never touches file inputs, never submits.

export interface FillOutcome {
  selector: string
  label: string
  status: 'filled' | 'skipped' | 'failed' | 'not_found'
  reason?: string
  value?: string
}

// React ignores direct `.value` writes (its instance tracker swallows them):
// call the prototype's setter, then fire input/change so controlled state
// catches up. Prototype lookup must go through the element's own realm —
// `HTMLInputElement.prototype` here would be the wrong realm under JSDOM.
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
  if (desc?.set) desc.set.call(el, value)
  else el.value = value
  const win = el.ownerDocument.defaultView
  const EventCtor = win?.Event ?? Event
  el.dispatchEvent(new EventCtor('input', { bubbles: true }))
  el.dispatchEvent(new EventCtor('change', { bubbles: true }))
}

function fillSelect(el: HTMLSelectElement, value: string): boolean {
  const target = value.trim().toLowerCase()
  const options = Array.from(el.options)
  const text = (o: HTMLOptionElement) => (o.textContent ?? '').trim().toLowerCase()
  const match =
    options.find((o) => o.value.trim().toLowerCase() === target) ??
    options.find((o) => text(o) === target) ??
    options.find((o) => text(o) !== '' && text(o).includes(target)) ??
    options.find((o) => text(o) !== '' && target.includes(text(o)))
  if (!match) return false
  el.value = match.value
  const win = el.ownerDocument.defaultView
  const EventCtor = win?.Event ?? Event
  el.dispatchEvent(new EventCtor('input', { bubbles: true }))
  el.dispatchEvent(new EventCtor('change', { bubbles: true }))
  return el.selectedIndex === options.indexOf(match)
}

export function isCombobox(el: Element): boolean {
  return el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list'
}

// A number input silently rejects non-numeric text, so "Jun 2026" must become
// "2026" BEFORE the write — fill and verify both coerce so they agree.
export function coerceValueForControl(el: Element, value: string): string {
  if ((el as HTMLInputElement).type === 'number' && !/^\d+(\.\d+)?$/.test(value.trim())) {
    const year = /\b(19|20)\d{2}\b/.exec(value)
    if (year) return year[0]
  }
  return value
}

export function applyFillToDocument(doc: Document, suggestions: FieldSuggestion[]): FillOutcome[] {
  return suggestions.map((s): FillOutcome => {
    const base = { selector: s.selector, label: s.label || s.canonical }
    if (s.do_not_fill) return { ...base, status: 'skipped', reason: s.note ?? 'Marked do-not-fill.' }
    if (!s.value) return { ...base, status: 'skipped', reason: s.note ?? 'No suggested value.' }
    const el = doc.querySelector(s.selector)
    if (!el) return { ...base, status: 'not_found', reason: 'Field no longer on the page.' }
    if (isCombobox(el)) {
      return { ...base, status: 'skipped', reason: 'Custom dropdown — pick this one manually.', value: s.value }
    }
    if (el instanceof (doc.defaultView?.HTMLSelectElement ?? HTMLSelectElement)) {
      const ok = fillSelect(el as HTMLSelectElement, s.value)
      return ok
        ? { ...base, status: 'filled', value: s.value }
        : { ...base, status: 'failed', reason: 'No matching option in the dropdown.', value: s.value }
    }
    const input = el as HTMLInputElement | HTMLTextAreaElement
    if (typeof input.value !== 'string') {
      return { ...base, status: 'failed', reason: 'Unsupported control type.', value: s.value }
    }
    if (input.type === 'checkbox' || input.type === 'radio') {
      return { ...base, status: 'skipped', reason: 'Checkbox/radio — tick this one yourself.', value: s.value }
    }
    const coerced = coerceValueForControl(input, s.value)
    setNativeValue(input, coerced)
    return input.value === coerced
      ? { ...base, status: 'filled', value: coerced }
      : { ...base, status: 'failed', reason: 'Page rejected the value.', value: s.value }
  })
}

// The verification half: read every expected value back from the live DOM.
// Comboboxes are excluded — their selection doesn't live in .value, so the
// caller (content script) verifies those against the rendered selection text.
export function verifyFill(doc: Document, suggestions: FieldSuggestion[]): { selector: string; ok: boolean; actual: string }[] {
  return suggestions
    .filter((s) => {
      if (!s.value || s.do_not_fill) return false
      const el = doc.querySelector(s.selector)
      return !el || !isCombobox(el)
    })
    .map((s) => {
      const el = doc.querySelector(s.selector) as HTMLInputElement | HTMLSelectElement | null
      if (!el) return { selector: s.selector, ok: false, actual: '' }
      const actual = typeof el.value === 'string' ? el.value : ''
      const ok =
        actual === coerceValueForControl(el, s.value!) ||
        // selects report the option VALUE; the suggestion may match its text
        (el instanceof (doc.defaultView?.HTMLSelectElement ?? HTMLSelectElement) &&
          ((el as HTMLSelectElement).selectedOptions[0]?.textContent ?? '').trim().toLowerCase() === s.value!.trim().toLowerCase())
      return { selector: s.selector, ok, actual }
    })
}

export function classifyFieldDeterministic(field: FieldInfo): CanonicalField {
  const haystack = `${field.label} ${field.name} ${field.id} ${field.placeholder}`

  // sensitive wins over everything, including autocomplete
  if (SENSITIVE_PATTERNS.test(haystack)) return 'SENSITIVE_DO_NOT_FILL'
  if (field.options.length > 0 && field.options.length <= 30 && SENSITIVE_PATTERNS.test(field.options.join(' ')))
    return 'SENSITIVE_DO_NOT_FILL'

  const ac = field.autocomplete.toLowerCase().trim()
  if (ac && AUTOCOMPLETE_MAP[ac]) return AUTOCOMPLETE_MAP[ac]
  if (field.input_type === 'email') return 'email'
  if (field.input_type === 'tel') return 'phone'

  for (const [canonical, pattern] of RULES) {
    if (pattern.test(haystack)) return canonical
  }
  return 'UNKNOWN'
}
