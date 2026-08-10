// Proves the fixture-based DOM verification harness works end to end:
// real HKUST board HTML (captured 2026-08-10) parsed by the same extractor
// code the extension content script will use. jsdom parses with parse5 — the
// same HTML5 algorithm as Chrome — so the harness DOM matches what the
// content script will see on the live board (happy-dom's parser truncated
// this board's legacy nested-table markup).
import fs from 'node:fs'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { extractApplyEmail, extractJpFromUrl, parseDetailTitle } from '@app/shared/extractors/hkust'

const FIXTURES = path.resolve(process.cwd(), 'tests/fixtures/hkust')

function loadDoc(name: string): Document {
  const html = fs.readFileSync(path.join(FIXTURES, name), 'utf8')
  return new JSDOM(html).window.document
}

describe('HKUST fixture harness', () => {
  it('extracts jp id from detail URLs', () => {
    expect(extractJpFromUrl('https://career.hkust.edu.hk/web/job_detail.php?jp=86585')).toBe('86585')
    expect(extractJpFromUrl('./job_detail.php?page=2&jp=123')).toBe('123')
    expect(extractJpFromUrl('https://career.hkust.edu.hk/web/job.php')).toBeNull()
  })

  it('parses title and jp from the detail page <title>', () => {
    const doc = loadDoc('detail-86585.html')
    const { title, jp } = parseDetailTitle(doc.title)
    expect(jp).toBe('86585')
    expect(title).toContain('Quant Researcher Intern')
  })

  it('extracts the apply email from the detail page', () => {
    const doc = loadDoc('detail-86585.html')
    expect(extractApplyEmail(doc)).toBe('APAC-Careers@jainglobal.com')
  })

  it('finds job rows on the list page', () => {
    const doc = loadDoc('list-page-1.html')
    const rows = doc.querySelectorAll('tr.job-item')
    expect(rows.length).toBeGreaterThanOrEqual(10)
  })
})
