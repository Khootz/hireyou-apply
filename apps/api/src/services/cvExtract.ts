// PDF → linearized text with reading-order reconstruction.
// pdfjs returns positioned glyph runs, not lines: we rebuild lines by y-band,
// detect two-column layouts per page via a midline whitespace band, and emit
// left column before right. Output feeds the LLM structuring step, which
// tolerates residual ordering noise but not interleaved columns.

export interface CvExtractResult {
  text: string
  pages: number
  warnings: string[]
}

interface Run {
  str: string
  x: number
  y: number
  w: number
}

export async function extractPdfText(data: Uint8Array): Promise<CvExtractResult> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise
  const warnings: string[] = []
  const pageTexts: string[] = []

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const viewport = page.getViewport({ scale: 1 })
    const tc = await page.getTextContent()
    const runs: Run[] = []
    for (const item of tc.items) {
      if (!('str' in item) || !item.str.trim()) continue
      runs.push({ str: item.str, x: item.transform[4], y: item.transform[5], w: item.width ?? 0 })
    }
    if (runs.length === 0) {
      warnings.push(`page ${p}: no extractable text (scanned image?)`)
      continue
    }
    pageTexts.push(renderPage(runs, viewport.width))
  }

  if (pageTexts.length === 0) {
    warnings.push('document contains no machine-readable text')
  }
  return { text: pageTexts.join('\n\n'), pages: doc.numPages, warnings }
}

function renderPage(runs: Run[], pageWidth: number): string {
  const mid = pageWidth / 2
  // Two-column detection: substantial content on both sides of a midline
  // band that almost nothing crosses.
  const crossing = runs.filter((r) => r.x < mid - 10 && r.x + r.w > mid + 10).length
  const left = runs.filter((r) => r.x + r.w <= mid)
  const right = runs.filter((r) => r.x >= mid)
  const twoColumn =
    crossing / runs.length < 0.05 &&
    left.length / runs.length > 0.25 &&
    right.length / runs.length > 0.25

  if (twoColumn) {
    return `${linesToText(groupLines(left))}\n${linesToText(groupLines(right))}`
  }
  return linesToText(groupLines(runs))
}

function groupLines(runs: Run[]): Run[][] {
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: Run[][] = []
  const Y_TOLERANCE = 3
  for (const run of sorted) {
    const current = lines[lines.length - 1]
    if (current && Math.abs(current[0].y - run.y) <= Y_TOLERANCE) {
      current.push(run)
    } else {
      lines.push([run])
    }
  }
  return lines.map((line) => line.sort((a, b) => a.x - b.x))
}

function linesToText(lines: Run[][]): string {
  return lines
    .map((line) => line.map((r) => r.str).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}
