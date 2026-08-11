// Untrusted text (scraped JDs, DOM field labels) is fenced before it enters a
// prompt so the model can attribute it as data, and fence lookalikes inside
// the text are defused so it cannot fake its own end-marker. System prompts
// reference these exact markers when telling the model what is data.

export function sanitizeUntrusted(text: string, maxLen = 4000): string {
  const cleaned = text
    // control chars (except \n and \t) can smuggle invisible instructions
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    // runs of 3+ angle brackets could reconstruct our fence markers
    .replace(/<{3,}/g, '<<')
    .replace(/>{3,}/g, '>>')
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen)}…` : cleaned
}

export function untrustedFenceOpen(label: string): string {
  return `<<<UNTRUSTED_${label}>>>`
}

export function untrustedFenceClose(label: string): string {
  return `<<<END_UNTRUSTED_${label}>>>`
}

export function delimitUntrusted(label: string, text: string, maxLen = 4000): string {
  if (!/^[A-Z][A-Z_]*$/.test(label)) throw new Error(`invalid untrusted-block label: ${label}`)
  return `${untrustedFenceOpen(label)}\n${sanitizeUntrusted(text, maxLen)}\n${untrustedFenceClose(label)}`
}
