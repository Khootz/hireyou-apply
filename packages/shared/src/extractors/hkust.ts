// HKUST career board (career.hkust.edu.hk) DOM extraction.
// Runs identically in the extension content script (live DOM) and in Vitest
// (fixture HTML via happy-dom). M0 ships the harness-proof subset; full
// extraction (company, JD text, deadline) lands in M6.

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
