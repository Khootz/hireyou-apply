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
  'work_authorization',
  'visa_sponsorship_required',
  'notice_period',
  'salary_expectation',
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

function resolveLabel(el: Element): string {
  const doc = el.ownerDocument
  const id = el.getAttribute('id')
  if (id) {
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/(["\\])/g, '\\$1')
    const forLabel = doc.querySelector(`label[for="${escaped}"]`)
    if (forLabel?.textContent?.trim()) return forLabel.textContent.trim()
  }
  const labelledBy = el.getAttribute('aria-labelledby')
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((lid) => doc.getElementById(lid)?.textContent?.trim() ?? '')
      .filter(Boolean)
    if (parts.length) return parts.join(' ')
  }
  const ariaLabel = el.getAttribute('aria-label')
  if (ariaLabel?.trim()) return ariaLabel.trim()
  const wrapping = el.closest('label')
  if (wrapping?.textContent?.trim()) return wrapping.textContent.trim()
  // nearest preceding text within the same container
  let node: Element | null = el
  for (let depth = 0; depth < 3 && node; depth++) {
    let sib = node.previousElementSibling
    while (sib) {
      const text = sib.textContent?.trim()
      if (text && text.length < 200) return text
      sib = sib.previousElementSibling
    }
    node = node.parentElement
  }
  return el.getAttribute('placeholder')?.trim() ?? ''
}

function stableSelector(el: Element, index: number): string {
  const id = el.getAttribute('id')
  if (id) return `#${id}`
  const name = el.getAttribute('name')
  if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`
  return `${el.tagName.toLowerCase()}:nth-of-type(${index + 1})`
}

const EXCLUDED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'file', 'password', 'search'])

export function discoverFields(doc: Document): FieldInfo[] {
  const fields: FieldInfo[] = []
  const elements = Array.from(doc.querySelectorAll('input, textarea, select'))
  elements.forEach((el, i) => {
    const tag = el.tagName.toLowerCase()
    const inputType = (el.getAttribute('type') ?? (tag === 'input' ? 'text' : '')).toLowerCase()
    if (tag === 'input' && EXCLUDED_INPUT_TYPES.has(inputType)) return
    if (!isVisible(el)) return
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
  ['portfolio_url', /\b(portfolio|personal\s*(web)?site)\b/i],
  ['current_company', /\b(current|present)\s*(company|employer)\b/i],
  ['current_title', /\b(current|present|most\s+recent)\s*(role|title|position)\b/i],
  ['years_experience', /\byears?\s*(of)?\s*(work\s*)?experience\b/i],
  ['education_institution', /\b(university|school|institution|college)\b/i],
  ['degree', /\b(degree|qualification|major)\b/i],
  ['graduation_date', /\bgraduat/i],
  ['work_authorization', /\b(work\s*authoriz|authoriz.*work|right\s*to\s*work|work\s*permit|legally\s*(entitled|authorized))/i],
  ['visa_sponsorship_required', /\b(visa|sponsor)/i],
  ['notice_period', /\bnotice\s*period\b/i],
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
