import {
  applyFillToDocument,
  coerceValueForControl,
  comboboxMenuOptions,
  datePartTarget,
  discoverFields,
  isCombobox,
  setNativeValue,
  verifyFill,
  type FieldSuggestion,
  type FillOutcome,
} from '@app/shared/autofill'

// Runs on every http(s) page (also injected on demand by the panel when the
// page loaded before the extension did — see the guard below).
//
// Two modes:
//  - apply-hints: grey placeholder hints only, nothing typed for the user.
//  - autofill: actually fills values, then runs a verify→retry loop — set the
//    value, read it back after the framework has had a tick to react, and
//    retry anything that got reverted with a keyboard-simulation fallback.
//    File inputs, checkboxes and custom dropdowns are reported, not touched.
//    NOTHING here ever submits the form.

const w = window as unknown as { __hireyouHintsLoaded?: boolean }
if (!w.__hireyouHintsLoaded) {
  w.__hireyouHintsLoaded = true
  init()
}

function init(): void {
  const originalPlaceholders = new Map<string, string>()

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'scan-form') {
      sendResponse({ fields: discoverFields(document), page_title: document.title, url: window.location.href })
      return false
    }
    if (message?.type === 'autofill') {
      void runAutofill(message.suggestions as FieldSuggestion[]).then(sendResponse)
      return true // async response
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
      showToast(`${applied} field hint${applied === 1 ? '' : 's'} shown · copy answers from the side panel · `)
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
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Menus read while OPEN, during driving — MokaHR unmounts menu contents on
// close, so an after-the-fact sweep sees empty nodes (live finding: zero
// options harvested despite a full fill pass). Longest list seen wins:
// type-filtering shrinks the visible list, the first open shows it whole.
const menuHarvest = new Map<Element, string[]>()

async function runAutofill(
  suggestions: FieldSuggestion[],
): Promise<{ outcomes: FillOutcome[]; menu_options: { selector: string; options: string[] }[] }> {
  menuHarvest.clear()
  // Pass 1: prototype-setter fill, verified synchronously. Fields are filled
  // one at a time with a short pause and a highlight flash — watchable, and
  // paced like fast typing rather than an instant blink.
  const outcomes: FillOutcome[] = []
  for (const s of suggestions) {
    const [outcome] = applyFillToDocument(document, [s])
    outcomes.push(outcome)
    if (outcome.status === 'filled') {
      const el = document.querySelector<HTMLElement>(s.selector)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      flash(el)
      await sleep(50)
    }
  }

  // Combobox pass: react-select style dropdowns can't be set via .value, but
  // they CAN be driven like a user — type the text, let the menu filter,
  // press Enter, then check the rendered selection actually shows the value.
  for (const o of outcomes) {
    if (o.status !== 'skipped' || !o.value) continue
    const s = suggestions.find((x) => x.selector === o.selector)
    const el = document.querySelector(o.selector)
    if (!s?.value || !(el instanceof HTMLInputElement) || !isCombobox(el)) continue
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    await sleep(100) // let the scroll finish so the menu opens where the eye is
    if (await fillCombobox(el, s.value)) {
      o.status = 'filled'
      o.reason = undefined
      flash(el.closest<HTMLElement>('.select-shell') ?? el)
    } else {
      o.reason = 'Dropdown — no matching option found, pick it manually.'
    }
  }

  // Late-revert sweep: a later widget's interaction can wipe an EARLIER
  // committed selection (framework re-render). Once everything has settled,
  // re-check every driven dropdown still displays a value; re-drive what got
  // wiped, and honestly fail whatever the page refuses to keep.
  await sleep(300)
  for (const o of outcomes) {
    if (o.status !== 'filled' || !o.value) continue
    const s = suggestions.find((x) => x.selector === o.selector)
    const el = document.querySelector(o.selector)
    if (!s?.value || !(el instanceof HTMLInputElement) || !isCombobox(el)) continue
    // standing selections render in the display node OR in the input itself
    // (sd-Select keeps some commits in .value) — never re-drive over either
    if (comboboxDisplay(el).trim() !== '' || el.value.trim() !== '') continue
    if (await fillCombobox(el, s.value)) {
      flash(el.closest<HTMLElement>('.select-shell') ?? el)
    } else {
      o.status = 'failed'
      o.reason = 'The page kept clearing this selection — pick it manually.'
    }
  }

  // Menu harvest: primarily what the driver saw while each menu was OPEN
  // (MokaHR unmounts menu contents on close); parked-in-DOM menus that were
  // never driven still contribute via the closed-state read.
  const menuOptions: { selector: string; options: string[] }[] = []
  for (const s of suggestions) {
    const el = document.querySelector(s.selector)
    if (!(el instanceof HTMLInputElement) || !isCombobox(el)) continue
    const options = menuHarvest.get(el) ?? comboboxMenuOptions(el)
    if (options.length >= 2) menuOptions.push({ selector: s.selector, options })
  }

  // Pass 2: give the page's framework a tick to react, then verify again —
  // a controlled component that ignored the events reverts the value here.
  await sleep(150)
  let failed = verifyFill(document, suggestions).filter((v) => !v.ok)

  // Pass 3: keyboard-simulation retry for anything reverted. Radio groups are
  // excluded — retyping text into a radio is meaningless; their verdict stands.
  for (const v of failed) {
    const s = suggestions.find((x) => x.selector === v.selector)
    const el = document.querySelector(v.selector)
    if (!s?.value || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) continue
    if (el instanceof HTMLInputElement && el.type === 'radio') continue
    const retryValue = coerceValueForControl(el, s.value)
    el.focus()
    el.select?.()
    try {
      document.execCommand('selectAll', false)
      document.execCommand('insertText', false, retryValue)
    } catch {
      setNativeValue(el, retryValue)
    }
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.blur()
  }
  if (failed.length > 0) await sleep(150)

  // Final verdict overrides pass-1 optimism.
  const finalState = new Map(verifyFill(document, suggestions).map((v) => [v.selector, v.ok]))
  for (const o of outcomes) {
    const ok = finalState.get(o.selector)
    if (ok === undefined) continue // skipped/do-not-fill rows keep their status
    if (ok && o.status !== 'filled') {
      o.status = 'filled'
      o.reason = undefined
    } else if (!ok && o.status === 'filled') {
      o.status = 'failed'
      o.reason = 'The page kept resetting this value — fill it manually.'
    }
  }

  const filled = outcomes.filter((o) => o.status === 'filled').length
  showToast(`filled ${filled}/${outcomes.length} fields · review before submitting · `)
  return { outcomes, menu_options: menuOptions }
}

// The committed selection of a select widget renders outside its input —
// react-select's single-value, AntD's selection-item, MokaHR's display-value.
function comboboxDisplay(el: HTMLElement): string {
  const shell =
    el.closest('[class*="Select-container"], .select-shell, .select__container, [class*="ant-select"]') ??
    el.parentElement?.parentElement
  const node = shell?.querySelector(
    '[class*="single-value"], [class*="multi-value"], [class*="selection-item"], [class*="display-value"]',
  )
  return ((node?.getAttribute('title') || node?.textContent) ?? '').toLowerCase()
}

// Poll until a condition holds — dropdown menus open/filter/close on their
// own schedule, so fixed sleeps either race them or waste demo time.
async function waitFor(cond: () => boolean, timeoutMs: number, stepMs = 60): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (cond()) return true
    await sleep(stepMs)
  }
  return cond()
}

// Drive a combobox like a user. Two widget families:
//  - react-select style: type → menu filters → click the option
//  - AntD/MokaHR style: the inner input is READONLY, typing does nothing —
//    the dropdown opens on CLICK and options render in a body-level portal
// Strategy: try typing; if no menu opened, click the widget shell open.
// Match options by text (with date-part extraction for year/month pickers),
// click the match, verify the rendered selection. Returns true only if the
// selection is verifiably rendered.
async function fillCombobox(el: HTMLInputElement, value: string, attempt = 0): Promise<boolean> {
  const pressKey = (key: string, keyCode: number) => {
    for (const type of ['keydown', 'keyup'] as const) {
      el.dispatchEvent(new KeyboardEvent(type, { key, keyCode, which: keyCode, bubbles: true, cancelable: true }))
    }
  }
  const clickOn = (target: HTMLElement) => {
    for (const type of ['mousedown', 'mouseup', 'click'] as const) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
    }
  }
  // MokaHR renders its menu inside the widget's own Dropdown-container (kept
  // in the DOM but parked offscreen when closed) — scope there first, filter
  // to options actually on screen
  const dropdownScope = el.closest<HTMLElement>('[class*="Dropdown-container"], .select-shell')
  const onScreen = (o: HTMLElement) => {
    const r = o.getBoundingClientRect()
    return r.height > 0 && r.top > -50 && r.top < window.innerHeight + 400
  }
  const menuOptions = (): HTMLElement[] => {
    const listId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns')
    const scope = (listId && document.getElementById(listId)) || dropdownScope || document.body
    return Array.from(
      scope.querySelectorAll<HTMLElement>(
        '[role="option"], [class*="select__option"], [class*="select-item-option"], [class*="Menu-container"]',
      ),
    ).filter(onScreen)
  }
  const menuOpen = () => el.getAttribute('aria-expanded') === 'true' || menuOptions().length > 0
  const selectedText = () => comboboxDisplay(el)
  // harvest the open menu for the answers-page vocabulary — unfiltered node
  // list (not the on-screen subset used for clicking), innermost items only
  const recordMenu = () => {
    const listId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns')
    const scope = (listId && document.getElementById(listId)) || dropdownScope || document.body
    const texts = Array.from(
      scope.querySelectorAll<HTMLElement>(
        '[role="option"], [class*="select__option"], [class*="select-item-option"], [class*="Menu-content-item"]',
      ),
    )
      .map((o) => (o.textContent ?? '').trim())
      .filter(Boolean)
    if (texts.length > (menuHarvest.get(el)?.length ?? 0)) menuHarvest.set(el, [...new Set(texts)])
  }
  const target = value.trim().toLowerCase()
  const text = (o: HTMLElement) => (o.textContent ?? '').trim().toLowerCase()
  const pickFrom = (options: HTMLElement[]): HTMLElement | undefined => {
    // year/month pickers: "2026-06-30" must match the "2026" / "6" option
    const datePart = datePartTarget(value, options.map((o) => o.textContent ?? ''))?.toLowerCase()
    const findFor = (needle: string) =>
      options.find((o) => text(o) === needle) ??
      options.find((o) => text(o).includes(needle)) ??
      options.find((o) => needle.includes(text(o)) && text(o) !== '')
    return (
      (datePart ? findFor(datePart) : findFor(target)) ??
      // the type-ahead already filtered: a single survivor IS the match
      (options.length === 1 ? options[0] : undefined)
    )
  }

  el.focus()
  clickOn(el)
  // The retry attempt drives WITHOUT typing: the type-filter re-renders the
  // menu, and a click on a node the re-render replaced silently does nothing
  // (seen live on PwC's programme select — the "selection" the user watched
  // vanish was only the typed filter text). The unfiltered list is stable.
  const typed = !el.readOnly && attempt === 0
  if (typed) setNativeValue(el, value) // typing filters the menu
  let lastTyped = typed ? value.trim().toLowerCase() : ''
  let opened = await waitFor(() => menuOptions().length > 0, el.readOnly ? 400 : 1500)
  if (!opened) {
    // still closed (readonly inner input) — click the shell open
    const shells = [el.parentElement, el.closest<HTMLElement>('[class*="selector"], [class*="select"]')]
    for (const shell of shells) {
      if (!shell) continue
      clickOn(shell)
      opened = await waitFor(() => menuOptions().length > 0, 700)
      if (opened) break
    }
  }

  if (opened) recordMenu()

  let match = pickFrom(menuOptions())
  if (!match && !el.readOnly && el.value) {
    // typed text filtered the menu to nothing ("No result") — clear it and
    // match against the FULL option list instead
    setNativeValue(el, '')
    lastTyped = ''
    await sleep(120)
    recordMenu() // unfiltered now — the fullest view of the choices
    match = pickFrom(menuOptions())
  }

  // No match = honest failure. NEVER fall back to pressing Enter on the open
  // menu: that commits whatever option happens to be highlighted, and the
  // wrong selection SURVIVES on the form even after verification fails —
  // seen live on PwC, where it stamped "Air Force Academy Taiwan" as the
  // user's school. No guess beats a wrong committed answer.
  let ok = false
  let chosen = ''
  if (match) {
    chosen = text(match)
    // the filter re-render may have swapped the matched node for a fresh one
    // — a click on the detached original goes nowhere, so re-grab by text
    if (!match.isConnected) match = menuOptions().find((o) => text(o) === chosen) ?? match
    // events bubble UP: click the innermost content node so the handler is
    // hit wherever the widget attached it (container vs inner item)
    clickOn(match.querySelector<HTMLElement>('[class*="content-item"]') ?? match)
    // the input matching what WE typed proves nothing — trust .value as a
    // commit signal only when the widget itself must have written it
    ok = await waitFor(
      () => selectedText().includes(chosen) || (el.value.trim().toLowerCase() === chosen && chosen !== lastTyped),
      1500,
    )
  }

  // Exit hygiene decides whether the selection SURVIVES. Leftover typed
  // filter text reads as uncommitted input — on blur the widget resets
  // itself and the just-made selection vanishes ("filled then deleted",
  // seen live on PwC). But when the widget renders its commit INSIDE the
  // input, clearing would wipe the selection — only clear when the
  // selection is safely rendered outside the input, or nothing committed.
  // And Escape is a REVERT key in many select widgets, so it is only safe
  // on the failure path.
  if (!el.readOnly && el.value && (!ok || selectedText().includes(chosen))) setNativeValue(el, '')
  if (!ok) pressKey('Escape', 27)
  el.blur()
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) // close click-away menus
  await waitFor(() => !menuOpen(), 800)
  await sleep(100) // settle: close animations finish before the next field

  // A matched option that would not commit is the type-filter race — retry
  // once from a settled state, without typing, before failing honestly.
  if (!ok && match && attempt === 0) return fillCombobox(el, value, 1)

  // Revert check: if cleanup (blur/close) cost us the selection, drive the
  // widget once more — the second pass starts from a settled, closed state
  // and types nothing. A commit standing in the input counts as surviving.
  const standing = selectedText().includes(chosen) || el.value.trim().toLowerCase() === chosen
  if (ok && chosen && !standing) {
    if (attempt === 0) return fillCombobox(el, value, 1)
    return false // honest failure: the page refuses to keep the selection
  }
  return ok
}

function flash(el: HTMLElement | null): void {
  if (!el) return
  const original = el.style.outline
  el.style.outline = '2px solid #22c55e'
  el.style.outlineOffset = '1px'
  setTimeout(() => {
    el.style.outline = original
  }, 700)
}

function showToast(text: string): void {
  document.getElementById('hireyou-toast')?.remove()
  const toast = document.createElement('div')
  toast.id = 'hireyou-toast'
  toast.textContent = `HireYou: ${text}`
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
