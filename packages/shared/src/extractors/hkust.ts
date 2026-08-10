// HKUST career board (career.hkust.edu.hk) DOM extraction.
// Runs identically in the extension content script (live DOM) and in Vitest
// (fixture HTML via jsdom). Selectors verified against fixtures captured
// 2026-08-10 and the user's 2025 scraper.
//
// Detail page anatomy:
//   <title>          "Quant Researcher Intern(86585) | Career Center | The HKUST"
//   table.large-view label row ("Company / Organization" | "Job Title Job Nature"
//                    | "Posting Date" | "Application Deadline") followed by the
//                    value row, aligned by column index
//   .career-content  full job content (company profile, JD, application method)
//   a[href^=mailto]  the apply email

export interface HkustJob {
  jp: string | null
  title: string
  company: string
  deadline: string
  apply_email: string | null
  jd_text: string
  source_url: string
}

export function extractJpFromUrl(url: string): string | null {
  const m = /[?&]jp=(\d+)/.exec(url)
  return m ? m[1] : null
}

/** Page titles look like: "Quant Researcher Intern(86585) | Career Center | The HKUST" */
export function parseDetailTitle(docTitle: string): { title: string; jp: string | null } {
  const m = /^(.*)\((\d+)\)\s*\|/.exec(docTitle.trim())
  if (!m) return { title: docTitle.trim(), jp: null }
  return { title: m[1].trim(), jp: m[2] }
}

export function extractApplyEmail(doc: Document): string | null {
  const links = Array.from(doc.querySelectorAll('a[href^="mailto:"]'))
  for (const a of links) {
    const href = a.getAttribute('href') ?? ''
    const email = href.slice('mailto:'.length).split('?')[0].trim()
    if (email) return email
  }
  return null
}

const cleanBlock = (s: string): string =>
  s.replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim()

function headerFields(doc: Document): { company: string; deadline: string } {
  const table = doc.querySelector('table.large-view')
  if (!table) return { company: '', deadline: '' }
  const rows = Array.from(table.querySelectorAll('tr')).map((r) =>
    Array.from(r.querySelectorAll('td')).map((td) => (td.textContent ?? '').replace(/\s+/g, ' ').trim()),
  )
  const labelIdx = rows.findIndex((cells) => cells.some((c) => /company\s*\/\s*organization/i.test(c)))
  if (labelIdx === -1 || labelIdx + 1 >= rows.length) return { company: '', deadline: '' }
  const labels = rows[labelIdx]
  const values = rows[labelIdx + 1]
  const valueFor = (pattern: RegExp): string => {
    const col = labels.findIndex((l) => pattern.test(l))
    return col >= 0 && col < values.length ? values[col] : ''
  }
  return {
    company: valueFor(/company/i),
    deadline: valueFor(/deadline/i),
  }
}

/** Full detail-page extraction. Returns null when the page isn't a job detail. */
export function extractHkustJobDetail(doc: Document, url: string): HkustJob | null {
  const { title, jp: jpFromTitle } = parseDetailTitle(doc.title ?? '')
  const jp = jpFromTitle ?? extractJpFromUrl(url)
  const scope = doc.querySelector('.career-content')
  if (!jp || !scope) return null

  const { company, deadline } = headerFields(doc)
  return {
    jp,
    title,
    company,
    deadline,
    apply_email: extractApplyEmail(doc),
    jd_text: cleanBlock(scope.textContent ?? '').slice(0, 4000),
    source_url: url,
  }
}
