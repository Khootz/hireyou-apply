import { discoverFields, type FieldSuggestion } from '@app/shared/autofill'

// Suggestion-first autofill (JobsDB / CTgoodjobs / generic apply forms).
// Suggestions render as grey hint text via the placeholder attribute — never
// as the field's value, so nothing can be submitted that the user did not
// type, and framework-controlled inputs are never fought with (spec §11.D
// simply doesn't apply). Copying real values happens from the side panel.

const originalPlaceholders = new Map<string, string>()

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'scan-form') {
    sendResponse({ fields: discoverFields(document), page_title: document.title, url: window.location.href })
    return false
  }
  if (message?.type === 'apply-hints') {
    const suggestions = message.suggestions as FieldSuggestion[]
    let applied = 0
    for (const s of suggestions) {
      if (!s.value || s.do_not_fill) continue
      const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(s.selector)
      if (!el || !('placeholder' in el)) continue
      if (el.value) continue // user already typed — never interfere
      if (!originalPlaceholders.has(s.selector)) originalPlaceholders.set(s.selector, el.placeholder)
      el.placeholder = s.value
      el.style.outline = '2px solid #93c5fd'
      el.style.outlineOffset = '1px'
      applied++
    }
    showToast(applied)
    sendResponse({ applied })
    return false
  }
  if (message?.type === 'clear-hints') {
    for (const [selector, original] of originalPlaceholders) {
      const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
      if (el) {
        el.placeholder = original
        el.style.outline = ''
      }
    }
    originalPlaceholders.clear()
    document.getElementById('hireyou-toast')?.remove()
    sendResponse({ ok: true })
    return false
  }
  return false
})

function showToast(count: number): void {
  document.getElementById('hireyou-toast')?.remove()
  const toast = document.createElement('div')
  toast.id = 'hireyou-toast'
  toast.textContent = `HireYou: ${count} field hint${count === 1 ? '' : 's'} shown · copy answers from the side panel · `
  const close = document.createElement('span')
  close.textContent = '×'
  close.style.cssText = 'cursor:pointer;font-weight:bold;padding-left:4px'
  close.onclick = () => toast.remove()
  toast.appendChild(close)
  toast.style.cssText =
    'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#1d4ed8;color:#fff;' +
    'padding:10px 14px;border-radius:10px;font:13px system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.25)'
  document.body.appendChild(toast)
}
