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
  'preferred_name',
  'name_pronunciation',
  'family_name_chinese',
  'given_name_chinese',
  'email',
  'phone',
  'phone_country_code',
  'location',
  'citizenship',
  'citizenship_status',
  'country_of_birth',
  'linkedin_url',
  'github_url',
  'portfolio_url',
  'current_company',
  'current_title',
  'years_experience',
  'department',
  'employee_type',
  'responsibilities',
  'education_institution',
  'school_country',
  'degree',
  'major',
  'academic_ranking',
  'graduation_date',
  // "What is your major type?" (PwC) — a different option set than Major
  // ("STEM Engineering" vs "Computer Engineering"); one answer can't serve both
  'major_type',
  // date-range widgets (MokaHR education/work period year+month selects) —
  // derived from the profile's entry dates, never asked on the answers page
  'education_period_start',
  'education_period_end',
  'work_period_start',
  'work_period_end',
  'highest_education_level',
  'work_authorization',
  'visa_sponsorship_required',
  'notice_period',
  'expected_start_date',
  'willing_to_relocate',
  'languages',
  'english_proficiency',
  'mandarin_proficiency',
  'cantonese_proficiency',
  'english_exam',
  'skills',
  'professional_qualification',
  'salary_expectation',
  'current_salary',
  'cover_letter',
  'why_this_role',
  'why_this_company',
  'proudest_accomplishment',
  'additional_info',
  'referral_source',
  'programme_interest',
  'open_to_other_opportunities',
  'previously_employed_here',
  'related_to_employee',
  'legal_declarations',
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
  // an input driven as a dropdown (MokaHR/AntD/react-select) — matters for
  // classification: a combobox asking "Mobile" is the country-CODE half
  is_combobox: z.boolean().default(false),
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

// Required-field markers ("First Name*", Lever's "✱") are noise for classification.
function cleanLabel(text: string): string {
  return text.replace(/\s*[*✱]\s*$/, '').trim()
}

// Widget chrome that reads as a label but never is one (MokaHR's inline
// validation text, select placeholders, empty-menu markers). ONLY_JUNK
// rejects labels that are nothing but chrome — a real question that merely
// CONTAINS "Please select" (Lever select wrappers) must survive.
const ONLY_JUNK = /^(required items are not filled in|please select|no result)$/i
const JUNK_LABEL = /required items are not filled in|^please select$|^no result$/i

function resolveLabel(el: Element): string {
  // Date-range widgets (MokaHR "Education period", "Start and End Date"):
  // four bare Year/Month selects around a "till" separator. Individually
  // they'd all label as "Year"/"Month" — synthesize the real question plus
  // which slot this select is, so each can classify to a period canonical.
  const range = el.closest('[class*="month-range-select"]')
  const part = el.getAttribute('placeholder')?.trim().toLowerCase()
  if (range && (part === 'year' || part === 'month')) {
    const question = precedingText(range)
    const till = range.querySelector('[class*="till-"]')
    // 4 = DOCUMENT_POSITION_FOLLOWING (no global Node in the test runtime)
    const side = till && till.compareDocumentPosition(el) & 4 ? 'end' : 'start'
    return cleanLabel(`${question} — ${side} ${part}`)
  }

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
  if (wrapping?.textContent?.trim()) {
    // A committed selection renders INSIDE the wrapping label (MokaHR's
    // display-value span, react-select's single-value) — that's the field's
    // current VALUE, not its question. Strip it before reading, or a filled
    // dropdown is forever labeled by whatever happens to be selected.
    const clone = wrapping.cloneNode(true) as HTMLElement
    clone
      .querySelectorAll('[class*="display-value"], [class*="single-value"], [class*="selection-item"]')
      .forEach((n) => n.remove())
    const text = cleanLabel(clone.textContent ?? '')
    // MokaHR wraps inputs in a label that holds only widget chrome — the
    // validation message must not become the field's "label"
    if (text && !ONLY_JUNK.test(text)) return text
  }
  const preceding = precedingText(el)
  if (preceding) return preceding
  return el.getAttribute('placeholder')?.trim() ?? ''
}

// nearest preceding text within the same container — walk deep enough to
// escape widget shells (MokaHR nests input→label→dropdown→tooltip→ctrl
// before the question title appears as a preceding sibling). Value-render
// nodes are skipped: a combobox input's previous sibling is the widget's
// display-value span, and a committed selection must never become the
// question ("Macau SAR, China" is an answer, not a label).
// depth 8: MokaHR multi-selects wrap the input two levels deeper than
// single selects (tag-container span + div) before the same shell chain
function precedingText(el: Element): string {
  const VALUE_RENDER = '[class*="display-value"], [class*="single-value"], [class*="selection-item"]'
  let node: Element | null = el
  for (let depth = 0; depth < 8 && node; depth++) {
    let sib = node.previousElementSibling
    while (sib) {
      if (!sib.matches(VALUE_RENDER)) {
        const text = sib.textContent?.trim()
        if (text && text.length < 400 && !JUNK_LABEL.test(text)) return cleanLabel(text)
      }
      sib = sib.previousElementSibling
    }
    node = node.parentElement
  }
  return ''
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

// A radio GROUP is one question, not N fields. Scanned per-option, the
// question text is lost — every option labels itself "Yes"/"No" and nothing
// classifies. The question usually sits just before the option list (Lever's
// .application-label, a fieldset legend, a plain heading) — walk up from the
// first option looking for preceding text.
function resolveGroupQuestion(el: Element): string {
  let node: Element | null = el
  for (let depth = 0; depth < 6 && node; depth++) {
    if (node.tagName === 'FIELDSET') {
      const legend = node.querySelector('legend')
      if (legend?.textContent?.trim()) return cleanLabel(legend.textContent)
    }
    let sib = node.previousElementSibling
    while (sib) {
      const text = sib.textContent?.trim()
      if (text && text.length >= 8 && text.length < 300) return cleanLabel(text)
      sib = sib.previousElementSibling
    }
    node = node.parentElement
  }
  return resolveLabel(el)
}

function radioOptionLabel(radio: Element): string {
  const wrapped = radio.closest('label')?.textContent?.trim()
  if (wrapped) return cleanLabel(wrapped)
  return cleanLabel(resolveLabel(radio))
}

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

  // pre-pass: collect visible named radios into groups (document order kept —
  // the group is emitted where its first option appears)
  const radioGroups = new Map<string, Element[]>()
  for (const el of elements) {
    if (el.tagName.toLowerCase() !== 'input') continue
    if ((el.getAttribute('type') ?? '').toLowerCase() !== 'radio') continue
    const name = el.getAttribute('name')
    if (!name || !isVisible(el) || el.hasAttribute('disabled')) continue
    const group = radioGroups.get(name) ?? []
    group.push(el)
    radioGroups.set(name, group)
  }

  const emittedGroups = new Set<string>()
  elements.forEach((el, i) => {
    const tag = el.tagName.toLowerCase()
    const inputType = (el.getAttribute('type') ?? (tag === 'input' ? 'text' : '')).toLowerCase()
    if (tag === 'input' && EXCLUDED_INPUT_TYPES.has(inputType)) return
    if (!isVisible(el)) return
    // screen-reader-hidden / keyboard-unreachable inputs are framework
    // internals (e.g. react-select's proxy "required" input), never real fields
    if (el.getAttribute('aria-hidden') === 'true') return
    if (el.getAttribute('tabindex') === '-1') return
    if (el.hasAttribute('disabled')) return
    // readonly normally means "not a field" — EXCEPT combobox widgets (AntD/
    // MokaHR selects), whose inner search input is readonly by design while
    // the dropdown around it is fully interactive
    if (el.hasAttribute('readonly') && !isCombobox(el)) return

    // named radios surface once, as their whole group
    const radioName = inputType === 'radio' ? el.getAttribute('name') : null
    if (radioName && radioGroups.has(radioName)) {
      if (emittedGroups.has(radioName)) return
      emittedGroups.add(radioName)
      const group = radioGroups.get(radioName)!
      fields.push(
        FieldInfoSchema.parse({
          selector: `input[name="${radioName.replace(/(["\\])/g, '\\$1')}"]`,
          tag: 'input',
          input_type: 'radio',
          name: radioName,
          id: '',
          autocomplete: '',
          placeholder: '',
          maxlength: null,
          required: group.some((r) => r.hasAttribute('required')),
          label: resolveGroupQuestion(group[0]),
          options: group.map(radioOptionLabel).filter(Boolean),
        }),
      )
      return
    }

    const maxlengthAttr = el.getAttribute('maxlength')
    const combobox = tag === 'input' && isCombobox(el)
    // A combobox's menu is readable at scan time only if the widget keeps it
    // in the DOM while closed — MokaHR renders menus LAZILY (empty until the
    // dropdown is first opened, proven by the user's fresh-page capture), so
    // this is best-effort; the fill pass harvests the populated menus after
    // driving them open.
    const options =
      tag === 'select'
        ? Array.from(el.querySelectorAll('option'))
            .map((o) => o.textContent?.trim() ?? '')
            .filter(Boolean)
        : combobox
          ? comboboxMenuOptions(el)
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
        // MokaHR stamps maxlength="-1" — a non-positive cap is "no cap", and
        // passing -1 through would slice() the last char off every answer
        maxlength: maxlengthAttr && Number(maxlengthAttr) > 0 ? Number(maxlengthAttr) : null,
        required: el.hasAttribute('required'),
        label: resolveLabel(el),
        options,
        is_combobox: combobox,
      }),
    )
  })
  return fields
}

// ---------- tier-1 deterministic classification ----------

const SENSITIVE_PATTERNS =
  /\b(gender|sex\b|race|ethnic|religio|veteran|disabilit|sexual\s*orientation|marital|date\s*of\s*birth|birth\s*date|\bdob\b|nationality|age\b|pregnan|criminal|convict)/i

const RULES: [CanonicalField, RegExp][] = [
  // "…please provide his/her full name & PwC email…" — employer-relation
  // questions mention email/name in the label and must win over both rules
  ['related_to_employee', /\brelated\s+to\s+(a|any)?\s*\w*\s*(partner|principal|employee)|\brelative\s+(work|employ)/i],
  ['email', /\be-?mail\b/i],
  // "Country/Region Code" next to a phone input — must beat the phone rule,
  // whose "contact number" phrasing appears in the same label (PwC/MokaHR)
  ['phone_country_code', /\b(country|region|dial(ing)?)\s*[/-]?\s*(region\s*)?code\b/i],
  ['phone', /\b(phone|mobile|contact\s*number|tel)\b/i],
  // Chinese-name variants (PwC campus forms) before the generic name rules —
  // "Family name in Chinese" must NOT receive the English family name
  ['family_name_chinese', /\b(family|last)\s*name\s*in\s*chinese|chinese\s*(family|last)\s*name/i],
  ['given_name_chinese', /\bgiven\s*name\s*in\s*chinese|chinese\s*(given|first)\s*name/i],
  // both BEFORE full_name: "How do you pronounce your name?" and "Preferred
  // Name" (Lever) contain "name" phrasings the name rules would claim
  ['name_pronunciation', /\bpronounc/i],
  ['preferred_name', /\b(preferred\s*(english\s*)?name|like\s+us\s+to\s+call|nickname)\b/i],
  ['full_name', /\b(full\s*name|your\s*name|applicant\s*name)\b/i],
  ['first_name', /\b(first|given)\s*name\b/i],
  ['last_name', /\b(last|family)\s*name|surname\b/i],
  ['linkedin_url', /linked\s*in/i],
  ['github_url', /github/i],
  ['portfolio_url', /\b(portfolio|personal\s*(web)?site|website)\b/i],
  // employer-specific screeners (PwC "Other" block)
  ['previously_employed_here', /\bhave\s+you\s+(ever\s+)?been\s+(employed|worked)|\bpreviously\s+(employed|worked)\s+(by|at|for|with)/i],
  ['programme_interest', /\bprogram(me)?\b[^?]{0,40}\binterested\b|\binterested\s+in\b[^?]{0,40}\bprogram(me)?\b/i],
  ['open_to_other_opportunities', /\b(willing|open)\s+to\s+consider\s+other|\bother\s+opportunit(y|ies)\b/i],
  ['legal_declarations', /\b(pcaob|rule\s*102|disciplinary\s+(sanction|proceeding)|civil\s+proceeding|labou?r\s+dispute)\b/i],
  // before current_company: "notice period to your current employer" must not
  // classify as the employer-name field
  ['notice_period', /\bnotice\s*period\b/i],
  // synthesized date-range labels ("Education period — start year",
  // "Start and End Date — end month") — before expected_start_date, whose
  // start-date phrasing could otherwise claim the work-period slots.
  // Internship "Period" and "Award time" ranges deliberately have NO rule:
  // the profile can't distinguish an internship from the latest job entry,
  // and a wrong date beats nothing. They stay honest manual fields.
  ['education_period_start', /\beducation\s*period\s*—\s*start\b/i],
  ['education_period_end', /\beducation\s*period\s*—\s*end\b/i],
  ['work_period_start', /\bstart\s+and\s+end\s+date\s*—\s*start\b/i],
  ['work_period_end', /\bstart\s+and\s+end\s+date\s*—\s*end\b/i],
  ['expected_start_date', /\b(start\s*date|earliest\s+(possible\s+)?(start|commencement)|when\s+can\s+you\s+start|date\s+available|available\s+(from|to\s+start))\b/i],
  ['willing_to_relocate', /\brelocat/i],
  // per-language proficiency selects (HK forms) before the generic language rule
  ['english_exam', /\benglish\s+(examination|exam|test)\b/i],
  ['english_proficiency', /\benglish\b.{0,20}proficien|proficien.{0,20}\benglish\b/i],
  ['mandarin_proficiency', /\b(mandarin|putonghua)\b/i],
  ['cantonese_proficiency', /\bcantonese\b/i],
  ['languages', /\blanguage/i],
  ['skills', /\bskills?\b/i],
  ['current_company', /\b(current|present)\s*(company|employer)\b/i],
  ['current_title', /\b(current|present|most\s+recent)\s*(role|title|position)\b/i],
  ['years_experience', /\byears?\s*(of)?\s*(work\s*)?experience\b/i],
  ['department', /\bdepartment\b/i],
  ['employee_type', /\bemploy(ee|ment)\s*type\b/i],
  ['responsibilities', /\bresponsibilit|\bduties\b/i],
  // before the school/education rules: "certificates of graduation … official
  // school transcript" (PwC) is a graduation-date question, not a school field
  ['graduation_date', /\bgraduat/i],
  // "Professional qualification" before the degree/education rules that also
  // use the word qualification
  ['professional_qualification', /\bprofessional\s+qualification|\bcertification\b/i],
  // "highest qualification / education level" must win over the degree and
  // institution rules below, which also mention qualification/education words
  ['highest_education_level', /\b(highest\s*(level\s*of\s*)?(education|qualification|degree)|education\s*level)\b/i],
  // "Country/Region of School" before both the institution rule (school) and
  // the location rule (country)
  ['school_country', /\b(country|region)[^?]{0,15}\bof\s+school|school[^?]{0,15}\b(country|region)\b/i],
  ['education_institution', /\b(university|school|institution|college)\b/i],
  // before major: "What is your major type?" has its own option vocabulary
  ['major_type', /\bmajor\s*type\b/i],
  ['major', /\bmajor\b/i],
  ['degree', /\b(degree|qualification)\b/i],
  ['academic_ranking', /\b(academic|class)\s+rank|ranking\b/i],
  // "Do you REQUIRE work authorisation or visa?" asks the sponsorship
  // question — the authorized-to-work rule below would invert the answer
  ['visa_sponsorship_required', /\brequire[sd]?\b[^?]{0,40}\b(authori[sz]ation|visa|sponsor)/i],
  ['work_authorization', /\b(work\s*authori[sz]|authori[sz].*work|right\s*to\s*work|work\s*permit|legally\s*(entitled|authori[sz]ed))/i],
  ['visa_sponsorship_required', /\b(visa|sponsor)/i],
  // citizenship before location: "Country/Region (Citizenship)" contains country
  ['citizenship_status', /\bcitizenship\s+status\b/i],
  ['citizenship', /\bcitizenship\b/i],
  ['country_of_birth', /\b(country|place|region)[^?]{0,15}\bof\s+birth\b/i],
  // "current salary" before the generic salary rule — expected vs drawn are
  // different questions with different answers
  ['current_salary', /\b(current|present|latest|last)\s*(monthly\s*|annual\s*)?(salary|pay|compensation)\b/i],
  ['salary_expectation', /\b(salary|compensation|expected\s*pay|remuneration)\b/i],
  ['cover_letter', /\bcover\s*letter\b/i],
  ['proudest_accomplishment', /\b(proudest|favou?rite\s+project|greatest\s+accomplishment)\b/i],
  ['why_this_role', /\bwhy\s+(do\s+you\s+want\s+)?(this|the)\s+(role|position|job)\b/i],
  ['why_this_company', /\bwhy\s+(do\s+you\s+want\s+to\s+(work|join)|us|our\s+company)\b/i],
  // "how you heard about" (Lever), "how did you hear" (Greenhouse), "from
  // which channel did you learn about" (PwC/MokaHR) all count
  ['referral_source', /\b(how\s+(did\s+)?you\s+hear(d)?\s+about|which\s+channel|where\s+did\s+you\s+(find|learn|see)|referr(al|ed))\b/i],
  ['location', /\b(location|city|address|country)\b/i],
  // LAST, deliberately: PwC's work-experience block labels its fields with
  // the bare words — anything more specific above ("why our company?",
  // "current title") must win first
  ['current_title', /\bjob\s*title\b/i],
  ['current_company', /\bcompany\b/i],
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
  group: string
  // Fixed choices rendered as a dropdown on the answers page. Static lists
  // cover the universal binaries (Yes/No); real forms' vocabularies are
  // harvested at scan time and override these (see answer_option_vocab).
  options?: string[]
}

export const ANSWER_QUESTIONS: AnswerQuestion[] = [
  // Identity
  { group: 'Identity', key: 'preferred_name', question: 'Preferred name / what should we call you?', hint: 'e.g. TZ — defaults to your first name if blank' },
  { group: 'Identity', key: 'name_pronunciation', question: 'How do you pronounce your name?', hint: 'e.g. TEEN-zhee KOO' },
  { group: 'Identity', key: 'family_name_chinese', question: 'Family name in Chinese', hint: 'e.g. 邱 — or N/A if not applicable' },
  { group: 'Identity', key: 'given_name_chinese', question: 'Given name in Chinese', hint: 'e.g. 天志 — or N/A if not applicable' },
  // Links
  { group: 'Links', key: 'linkedin_url', question: 'LinkedIn profile URL', hint: 'https://linkedin.com/in/…' },
  { group: 'Links', key: 'github_url', question: 'GitHub profile URL', hint: 'https://github.com/…' },
  { group: 'Links', key: 'portfolio_url', question: 'Personal website / portfolio', hint: 'https://…' },
  { group: 'Identity', key: 'location', question: 'Current country/region (as application forms word it)', hint: 'e.g. Hong Kong SAR, China — overrides the location from your profile on forms' },
  // Work eligibility
  { group: 'Work eligibility', key: 'work_authorization', question: 'Are you authorized to work in your target location?', hint: 'e.g. Yes', options: ['Yes', 'No'] },
  { group: 'Work eligibility', key: 'visa_sponsorship_required', question: 'Do you require visa sponsorship / work authorisation?', hint: 'e.g. No', options: ['Yes', 'No'] },
  { group: 'Work eligibility', key: 'citizenship', question: 'Country/Region of citizenship', hint: 'e.g. Malaysia' },
  { group: 'Work eligibility', key: 'citizenship_status', question: 'Citizenship / residency status', hint: 'e.g. Hong Kong resident (student visa)' },
  { group: 'Work eligibility', key: 'country_of_birth', question: 'Country/Region of birth (only filled if you answer it)', hint: 'e.g. Malaysia — leave blank to always fill manually' },
  // Availability & pay
  { group: 'Availability & pay', key: 'notice_period', question: 'Notice period / availability', hint: 'e.g. Available immediately' },
  { group: 'Availability & pay', key: 'expected_start_date', question: 'Earliest start date', hint: 'e.g. 1 June 2026 — or Immediately' },
  { group: 'Availability & pay', key: 'salary_expectation', question: 'Expected salary', hint: 'e.g. HKD 25,000/month' },
  { group: 'Availability & pay', key: 'current_salary', question: 'Current / most recent salary', hint: 'e.g. HKD 20,000/month — or Prefer not to disclose' },
  { group: 'Availability & pay', key: 'willing_to_relocate', question: 'Willing to relocate?', hint: 'e.g. Yes', options: ['Yes', 'No'] },
  // Education
  { group: 'Education', key: 'highest_education_level', question: 'Highest education level', hint: "e.g. Bachelor's degree (in progress)" },
  { group: 'Education', key: 'graduation_date', question: 'Expected graduation / certificate date', hint: 'e.g. 2026-06-30' },
  { group: 'Education', key: 'school_country', question: 'Country/Region of your school', hint: 'e.g. Hong Kong SAR' },
  { group: 'Education', key: 'major', question: 'Major / field of study', hint: 'e.g. Computer Engineering' },
  { group: 'Education', key: 'major_type', question: 'Major type / category (when a form asks separately)', hint: 'e.g. STEM Engineering' },
  { group: 'Education', key: 'degree', question: 'Degree category (as fixed-choice forms word it)', hint: 'e.g. Full-time Bachelor Degree — overrides the degree text from your profile' },
  { group: 'Education', key: 'academic_ranking', question: 'Academic ranking', hint: 'e.g. Top 10% — or Not ranked' },
  // Experience
  { group: 'Experience', key: 'years_experience', question: 'Years of professional experience', hint: 'e.g. 2' },
  { group: 'Experience', key: 'department', question: 'Department (latest role)', hint: 'e.g. Engineering' },
  { group: 'Experience', key: 'employee_type', question: 'Employment type (latest role)', hint: 'e.g. Internship' },
  { group: 'Experience', key: 'proudest_accomplishment', question: 'Proudest accomplishment / favorite project (default answer)', hint: 'A few sentences — used when a form asks for your proudest work' },
  // Languages & skills
  { group: 'Languages & skills', key: 'languages', question: 'Languages you speak', hint: 'e.g. English (fluent), Mandarin (native), Cantonese (conversational)' },
  { group: 'Languages & skills', key: 'english_proficiency', question: 'English proficiency', hint: 'e.g. Fluent' },
  { group: 'Languages & skills', key: 'mandarin_proficiency', question: 'Mandarin / Putonghua proficiency', hint: 'e.g. Native' },
  { group: 'Languages & skills', key: 'cantonese_proficiency', question: 'Cantonese proficiency', hint: 'e.g. Conversational' },
  { group: 'Languages & skills', key: 'english_exam', question: 'Public English examination taken', hint: 'e.g. IELTS — or None' },
  { group: 'Languages & skills', key: 'skills', question: 'Top skill (single answer for skill dropdowns)', hint: 'e.g. Python' },
  { group: 'Languages & skills', key: 'professional_qualification', question: 'Professional qualification', hint: 'e.g. None' },
  // Employer questions
  { group: 'Employer questions', key: 'referral_source', question: 'How did you hear about us? (default answer)', hint: 'e.g. LinkedIn' },
  { group: 'Employer questions', key: 'programme_interest', question: 'Programme you are applying to (update per season)', hint: 'e.g. FY27 Winter Intern' },
  { group: 'Employer questions', key: 'open_to_other_opportunities', question: 'Willing to consider other opportunities?', hint: 'e.g. Yes', options: ['Yes', 'No'] },
  { group: 'Employer questions', key: 'previously_employed_here', question: 'Previously employed by the company you apply to? (default)', hint: 'e.g. No', options: ['Yes', 'No'] },
  { group: 'Employer questions', key: 'related_to_employee', question: 'Related to an employee of the company? (default)', hint: 'e.g. No', options: ['Yes', 'No'] },
  { group: 'Employer questions', key: 'legal_declarations', question: 'Legal/regulatory declarations (civil proceedings, disputes…)', hint: 'Applies to the whole standard compliance checklist', options: ['Yes', 'No'] },
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

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

// Date-part selects (PwC/MokaHR education periods, graduation dates): a
// "2026-06-30" or "Jun 2026" answer must land as "2026" in a year select and
// as "6"/"Jun"/"June" in a month select — the raw string matches nothing.
// Takes plain option texts so combobox menus (extension) can use it too.
export function datePartTarget(value: string, optionTexts: string[]): string | null {
  const texts = optionTexts.map((t) => t.trim()).filter(Boolean)
  if (texts.length === 0) return null
  const nonEmpty = texts.filter((t) => !/select|please|choose/i.test(t))
  if (nonEmpty.length === 0) return null
  if (nonEmpty.every((t) => /^(19|20)\d{2}$/.test(t))) {
    return /(19|20)\d{2}/.exec(value)?.[0] ?? null
  }
  const numericMonths = nonEmpty.every((t) => /^\d{1,2}$/.test(t) && Number(t) >= 1 && Number(t) <= 12)
  const namedMonths = nonEmpty.every((t) => MONTH_NAMES.includes(t.slice(0, 3).toLowerCase()))
  if (numericMonths || namedMonths) {
    const lower = value.toLowerCase()
    let month = MONTH_NAMES.findIndex((m) => lower.includes(m)) + 1
    if (month === 0) {
      const iso = /\b(19|20)\d{2}[-/](\d{1,2})/.exec(value)
      if (iso) month = Number(iso[2])
    }
    if (month < 1 || month > 12) return null
    return numericMonths ? String(month) : MONTH_NAMES[month - 1]
  }
  return null
}

function fillSelect(el: HTMLSelectElement, value: string): boolean {
  const options = Array.from(el.options)
  const text = (o: HTMLOptionElement) => (o.textContent ?? '').trim().toLowerCase()
  const findFor = (needle: string) =>
    options.find((o) => o.value.trim().toLowerCase() === needle) ??
    options.find((o) => text(o) === needle) ??
    options.find((o) => text(o) !== '' && text(o).includes(needle)) ??
    options.find((o) => text(o) !== '' && needle.includes(text(o)))
  // year/month selects must match on the extracted date part ONLY — the
  // generic substring fallback would happily match the "2" in "2026-06-30"
  const datePart = datePartTarget(value, options.map((o) => o.textContent ?? ''))
  const match = datePart !== null ? findFor(datePart.toLowerCase()) : findFor(value.trim().toLowerCase())
  if (!match) return false
  el.value = match.value
  const win = el.ownerDocument.defaultView
  const EventCtor = win?.Event ?? Event
  el.dispatchEvent(new EventCtor('input', { bubbles: true }))
  el.dispatchEvent(new EventCtor('change', { bubbles: true }))
  return el.selectedIndex === options.indexOf(match)
}

export function isCombobox(el: Element): boolean {
  if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list') return true
  // MokaHR/AntD-style selects carry NO combobox ARIA at all — they are plain
  // text inputs inside a select-shell label. Typing into them as text fields
  // filters their menu without ever committing a value (seen live on PwC).
  return !!el.closest('[class*="Select-container"], [class*="select-container"], [class*="ant-select"]')
}

// Option texts of a (closed) combobox whose menu lives in the surrounding
// widget shell — MokaHR parks the full menu offscreen in the widget's own
// Dropdown node. Portal-rendered menus (react-select) aren't in the shell
// until opened, so this honestly returns [] for them.
export function comboboxMenuOptions(el: Element): string[] {
  const shell = el.closest('[class*="Dropdown-container"], .select-shell')
  if (!shell) return []
  const items = shell.querySelectorAll<HTMLElement>(
    '[class*="Menu-content-item"], [role="option"], [class*="select__option"], [class*="select-item-option"]',
  )
  const seen = new Set<string>()
  for (const item of Array.from(items)) {
    const text = item.textContent?.trim()
    if (text) seen.add(text)
  }
  return Array.from(seen)
}

// "Please select", "Choose…", "---" — prompt rows, not answers. Used when
// harvesting form vocabularies so the answers page only offers real choices.
// Our own answers-page sentinels are here too: scanning our own app must
// never harvest our own UI chrome back into the vocabulary.
export function isPlaceholderOption(text: string): boolean {
  const t = text.trim()
  return (
    /^(please\s+(select|choose)\b.*|select\b.{0,15}|choose\b.{0,10}|-+|—+|…|\.{2,})$/i.test(t) ||
    /^—\s*not\s*answered\s*—$/i.test(t) ||
    /^custom\s*answer…?$/i.test(t) ||
    t === ''
  )
}

// Saved answers are prose ("Yes — Hong Kong resident, no permit needed");
// options are terse ("Yes"). Match progressively: exact → answer starts with
// the option → option starts with the answer → option contains the answer.
// Returns the option index, -1 when nothing matches (no guessing).
export function matchOption(value: string, options: string[]): number {
  const target = value.trim().toLowerCase()
  if (!target) return -1
  const texts = options.map((o) => o.trim().toLowerCase())
  let idx = texts.findIndex((t) => t === target)
  if (idx === -1) idx = texts.findIndex((t) => t !== '' && target.startsWith(t))
  if (idx === -1) idx = texts.findIndex((t) => t !== '' && t.startsWith(target))
  if (idx === -1) idx = texts.findIndex((t) => t !== '' && t.includes(target))
  return idx
}

function groupRadios(doc: Document, selector: string): HTMLInputElement[] {
  return Array.from(doc.querySelectorAll(selector)).filter(
    (r): r is HTMLInputElement => (r as HTMLInputElement).type === 'radio',
  )
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
    if (input.type === 'radio') {
      // a radio group answers from the saved answer — pick the matching
      // option, check it, fire events; no match = honest failure, no guess
      const radios = groupRadios(doc, s.selector)
      const labels = radios.map(radioOptionLabel)
      const idx = matchOption(s.value, labels)
      if (idx === -1) {
        return { ...base, status: 'failed', reason: 'No option matches your saved answer — pick it yourself.', value: s.value }
      }
      const chosen = radios[idx]
      chosen.checked = true
      const win = chosen.ownerDocument.defaultView
      const EventCtor = win?.Event ?? Event
      chosen.dispatchEvent(new EventCtor('input', { bubbles: true }))
      chosen.dispatchEvent(new EventCtor('change', { bubbles: true }))
      return chosen.checked
        ? { ...base, status: 'filled', value: labels[idx] }
        : { ...base, status: 'failed', reason: 'Page rejected the selection.', value: s.value }
    }
    if (input.type === 'checkbox') {
      return { ...base, status: 'skipped', reason: 'Checkbox — tick this one yourself.', value: s.value }
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
      // radio group: verified when the checked option is the one the saved
      // answer matches — .value would read the option value of the first radio
      if ((el as HTMLInputElement).type === 'radio') {
        const radios = groupRadios(doc, s.selector)
        const labels = radios.map(radioOptionLabel)
        const idx = matchOption(s.value!, labels)
        const checked = radios.findIndex((r) => r.checked)
        return { selector: s.selector, ok: idx !== -1 && checked === idx, actual: checked === -1 ? '' : labels[checked] }
      }
      const actual = typeof el.value === 'string' ? el.value : ''
      let ok = actual === coerceValueForControl(el, s.value!)
      if (!ok && el instanceof (doc.defaultView?.HTMLSelectElement ?? HTMLSelectElement)) {
        // selects report the option VALUE; the suggestion may match its text,
        // or — for year/month selects — the extracted date part
        const select = el as HTMLSelectElement
        const selectedText = (select.selectedOptions[0]?.textContent ?? '').trim().toLowerCase()
        const datePart = datePartTarget(s.value!, Array.from(select.options).map((o) => o.textContent ?? ''))
        ok =
          selectedText === s.value!.trim().toLowerCase() ||
          (datePart !== null && selectedText === datePart.toLowerCase())
      }
      return { selector: s.selector, ok, actual }
    })
}

export function classifyFieldDeterministic(field: FieldInfo): CanonicalField {
  const haystack = `${field.label} ${field.name} ${field.id} ${field.placeholder}`

  // sensitive wins over everything, including autocomplete
  if (SENSITIVE_PATTERNS.test(haystack)) return 'SENSITIVE_DO_NOT_FILL'
  if (field.options.length > 0 && field.options.length <= 30 && SENSITIVE_PATTERNS.test(field.options.join(' ')))
    return 'SENSITIVE_DO_NOT_FILL'

  // Checkboxes are never filled, so a value-bearing canonical is always wrong
  // — on Lever's real language checklist, "Telugu (TEL)" hit the phone rule.
  // Radio GROUPS are exempt: they arrive as one field carrying the actual
  // question ("Are you legally authorized…?") and CAN be answered.
  // Sensitive stays above: the amber warning must render on EEO tick-boxes.
  if (field.input_type === 'checkbox') return 'UNKNOWN'

  // "Referral code" is an invite code, not "how did you hear about us" —
  // the referral_source rule would otherwise type "LinkedIn" into it (PwC)
  if (/\breferral\s*code\b/i.test(haystack)) return 'UNKNOWN'
  // PwC's primary name field is labeled just "Name" — too bare for the
  // rules, exact enough to trust on its own
  if (/^name$/i.test(field.label.trim())) return 'full_name'

  const ac = field.autocomplete.toLowerCase().trim()
  if (ac && AUTOCOMPLETE_MAP[ac]) return AUTOCOMPLETE_MAP[ac]
  if (field.input_type === 'email') return 'email'
  if (field.input_type === 'tel') return field.is_combobox ? 'phone_country_code' : 'phone'

  for (const [canonical, pattern] of RULES) {
    if (pattern.test(haystack)) {
      // a DROPDOWN asking "Mobile" is the country-code half of a split-phone
      // widget (MokaHR) — the free-text half gets the actual number
      if (canonical === 'phone' && field.is_combobox) return 'phone_country_code'
      return canonical
    }
  }
  return 'UNKNOWN'
}
