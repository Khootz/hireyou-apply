import type { HkustJob } from '@app/shared/extractors/hkust'

// Side panel UI. Vanilla TS: the panel is a thin API client — all
// intelligence is server-side (mirrors Amploy's 88 KiB philosophy).

interface Settings {
  apiUrl: string
  token: string
  webUrl: string
}

interface SavedJob {
  id: string
  status: string
}

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T
const content = () => $('#content')

async function getSettings(): Promise<Settings> {
  const s = await chrome.storage.local.get(['apiUrl', 'token', 'webUrl'])
  return {
    apiUrl: (s.apiUrl as string) || 'http://127.0.0.1:3100',
    token: (s.token as string) || '',
    webUrl: (s.webUrl as string) || 'http://localhost:5180',
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const s = await getSettings()
  const res = await fetch(`${s.apiUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${s.token}`,
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

// ---------- settings UI ----------

async function initSettings(): Promise<void> {
  const s = await getSettings()
  ;($('#set-api-url') as HTMLInputElement).value = s.apiUrl
  ;($('#set-token') as HTMLInputElement).value = s.token
  ;($('#set-web-url') as HTMLInputElement).value = s.webUrl

  $('#settings-toggle').addEventListener('click', () => $('#settings').classList.toggle('hidden'))
  $('#save-settings').addEventListener('click', async () => {
    await chrome.storage.local.set({
      apiUrl: ($('#set-api-url') as HTMLInputElement).value.trim().replace(/\/$/, ''),
      token: ($('#set-token') as HTMLInputElement).value.trim(),
      webUrl: ($('#set-web-url') as HTMLInputElement).value.trim().replace(/\/$/, ''),
    })
    $('#settings-status').textContent = 'Saved.'
    try {
      await api('/health')
      $('#settings-status').textContent = '✓ Saved — API reachable.'
      $('#settings').classList.add('hidden')
      void render()
    } catch (err) {
      $('#settings-status').textContent = `Saved, but API unreachable: ${(err as Error).message}`
    }
  })
}

// ---------- job card ----------

let currentJob: HkustJob | null = null
let savedJob: SavedJob | null = null

async function detectJob(): Promise<HkustJob | null> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: 'get-active-job' })) as { job: HkustJob | null }
    return res?.job ?? null
  } catch {
    return null
  }
}

async function render(): Promise<void> {
  const s = await getSettings()
  if (!s.token) {
    content().innerHTML = `<div class="card"><div class="banner warn">Set your API token first</div>
      <p class="muted" style="margin-top:8px">Open ⚙ settings and paste the token from your project's .env (API_AUTH_TOKEN).</p></div>`
    $('#settings').classList.remove('hidden')
    return
  }

  currentJob = await detectJob()
  if (!currentJob) {
    content().innerHTML = `<div class="card"><h2>No job detected</h2>
      <p class="muted">Open a job posting on the <a href="https://career.hkust.edu.hk/web/job.php" target="_blank">HKUST career board</a> and this panel will pick it up.</p></div>
      <div class="card"><h2>On an application form?</h2>
      <p class="muted" style="margin-bottom:8px">I can scan any application page, suggest answers from your profile, and fill the form for you. You review every field — nothing is ever submitted automatically, and demographic questions are never touched.</p>
      <button class="primary" id="scan-form">Scan this page</button>
      <div id="scan-status" class="muted" style="margin-top:6px"></div>
      <div id="scan-results" style="margin-top:8px;display:flex;flex-direction:column;gap:6px"></div></div>`
    document.querySelector('#scan-form')?.addEventListener('click', scanForm)
    return
  }

  // saved-state lookup (dedup-aware)
  savedJob = null
  try {
    const match = await api<{ job: SavedJob | null }>(
      `/api/jobs/match?board=hkust&company=${encodeURIComponent(currentJob.company)}&title=${encodeURIComponent(currentJob.title)}`,
    )
    savedJob = match.job
  } catch {
    content().innerHTML = `<div class="card"><div class="banner err">Cannot reach the API. Is <code>npm run dev</code> running? Check ⚙ settings.</div></div>`
    return
  }

  renderJobCard()
}

function renderJobCard(): void {
  if (!currentJob) return
  const job = currentJob
  const saved = savedJob

  content().innerHTML = `
    <div class="card">
      ${saved ? `<div class="banner">✓ SAVED TO HIREYOU</div>` : ''}
      <h2 style="margin-top:${saved ? '8px' : '0'}">${esc(job.title)}</h2>
      <div class="muted">${esc(job.company)}${job.deadline ? ` · deadline ${esc(job.deadline)}` : ''}</div>
      ${job.apply_email ? `<div class="muted">✉ ${esc(job.apply_email)}</div>` : ''}
      <div style="margin-top:10px">
        ${
          saved
            ? `<label>Status</label><select id="job-status">
                ${['saved', 'applied', 'interviewing', 'offered', 'rejected']
                  .map((st) => `<option value="${st}" ${saved.status === st ? 'selected' : ''}>${st[0].toUpperCase()}${st.slice(1)}</option>`)
                  .join('')}
              </select>`
            : `<button class="primary" id="save-job">Save to HireYou</button>`
        }
      </div>
    </div>
    ${
      saved
        ? `<div class="card" style="display:flex;flex-direction:column;gap:8px">
            <div class="gen-row"><div><strong>📄 Resume</strong><div class="muted">Tailored to this job</div></div>
              <button class="secondary" data-gen="resume">Generate</button></div>
            <div class="gen-row"><div><strong>✉️ Cover letter</strong><div class="muted">Tailored to this job</div></div>
              <button class="secondary" data-gen="cover_letter">Generate</button></div>
            <div id="gen-status" class="muted"></div>
            <a id="view-in-app" href="#" target="_blank">View in HireYou ↗</a>
          </div>`
        : ''
    }
  `

  $('#save-job')?.addEventListener('click', saveJob)
  document.querySelector('#job-status')?.addEventListener('change', async (e) => {
    if (!savedJob) return
    const status = (e.target as HTMLSelectElement).value
    await api(`/api/jobs/${savedJob.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
    savedJob.status = status
  })
  document.querySelectorAll<HTMLButtonElement>('[data-gen]').forEach((btn) =>
    btn.addEventListener('click', () => generate(btn.dataset.gen as 'resume' | 'cover_letter', btn)),
  )
  getSettings().then((s) => {
    const link = document.querySelector<HTMLAnchorElement>('#view-in-app')
    if (link && savedJob) link.href = `${s.webUrl}/jobs/${savedJob.id}`
  })
}

async function saveJob(): Promise<void> {
  if (!currentJob) return
  const res = await api<{ job: SavedJob }>(`/api/jobs`, {
    method: 'POST',
    body: JSON.stringify({
      title: currentJob.title,
      company: currentJob.company,
      source_url: currentJob.source_url,
      source_board: 'hkust',
      jd_text: currentJob.jd_text,
      apply_email: currentJob.apply_email,
      deadline: currentJob.deadline,
    }),
  })
  savedJob = res.job
  renderJobCard()
}

async function generate(type: 'resume' | 'cover_letter', btn: HTMLButtonElement): Promise<void> {
  if (!savedJob) return
  const status = $('#gen-status')
  btn.disabled = true
  status.textContent = '⏳ Generating… usually ~20s. Keep this panel open.'
  try {
    const { run } = await api<{ run: { id: string } }>(`/api/jobs/${savedJob.id}/generate`, {
      method: 'POST',
      body: JSON.stringify({ type }),
    })
    const timer = setInterval(async () => {
      try {
        const r = await api<{ status: string; error: string | null }>(`/api/runs/${run.id}`)
        if (r.status === 'succeeded') {
          clearInterval(timer)
          btn.disabled = false
          status.textContent = `✓ ${type === 'resume' ? 'Resume' : 'Cover letter'} ready — View in HireYou ↗`
        } else if (r.status === 'failed') {
          clearInterval(timer)
          btn.disabled = false
          status.textContent = `⚠ Generation failed: ${r.error ?? 'unknown error'}`
        }
      } catch {
        clearInterval(timer)
        btn.disabled = false
        status.textContent = '⚠ Lost contact with the API.'
      }
    }, 1500)
  } catch (err) {
    btn.disabled = false
    status.textContent = `⚠ ${(err as Error).message}`
  }
}

interface FieldSuggestionLite {
  selector: string
  canonical: string
  label: string
  value: string | null
  do_not_fill: boolean
  note?: string
}

interface FillOutcomeLite {
  selector: string
  label: string
  status: 'filled' | 'skipped' | 'failed' | 'not_found'
  reason?: string
  value?: string
}

// Usage telemetry (M9): report which suggestions actually got used so the
// classifier can be judged on real forms later. Values never leave the page —
// only the canonical field name and what happened. Fire-and-forget: telemetry
// must never break or slow the fill flow.
function reportUsage(
  fingerprint: string,
  events: { canonical_field: string; action: 'copied' | 'dismissed' | 'ignored' }[],
): void {
  if (!fingerprint || events.length === 0) return
  void api('/api/autofill/events', {
    method: 'POST',
    body: JSON.stringify({ form_fingerprint: fingerprint, events }),
  }).catch(() => {})
}

// The content script is declared for every http(s) page, but pages that were
// already open when the extension loaded (or reloaded) don't have it yet —
// inject on demand instead of telling the user "unsupported".
async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ping' })
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content-hints.js'] })
  }
}

async function scanForm(): Promise<void> {
  const status = $('#scan-status')
  const results = $('#scan-results')
  results.innerHTML = ''
  status.textContent = 'Scanning the page…'
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    if (tab?.id === undefined) throw new Error('no active tab')
    const tabId = tab.id
    let scan: { fields: unknown[] }
    try {
      await ensureContentScript(tabId)
      scan = await chrome.tabs.sendMessage(tabId, { type: 'scan-form' })
    } catch {
      status.textContent = 'Cannot scan this page — browser-internal and extension-store pages are off limits.'
      return
    }
    if (!scan?.fields?.length) {
      status.textContent = 'No form fields found on this page.'
      return
    }
    status.textContent = `${scan.fields.length} fields found — asking for suggestions…`
    const { suggestions, form_fingerprint } = await api<{
      suggestions: FieldSuggestionLite[]
      form_fingerprint: string
    }>(`/api/autofill`, {
      method: 'POST',
      body: JSON.stringify({ fields: scan.fields, job_id: null }),
    })
    const withValue = suggestions.filter((s) => s.value && !s.do_not_fill)
    if (withValue.length === 0) {
      status.textContent = 'No confident suggestions for this form — fill it manually.'
      return
    }
    status.textContent = `${withValue.length} suggestion${withValue.length === 1 ? '' : 's'} ready.`
    results.innerHTML =
      `<button class="primary" id="do-autofill">⚡ Autofill ${withValue.length} field${withValue.length === 1 ? '' : 's'}</button>
       <div class="muted" style="font-size:12px">Fills the form for you — nothing is ever submitted automatically.</div>` +
      suggestions
        .map((s) => {
          if (s.do_not_fill) {
            return `<div class="gen-row" style="border-color:#fde68a"><div><strong>${esc(s.label || s.canonical)}</strong>
              <div class="muted">${esc(s.note ?? 'Not suggested.')}</div></div></div>`
          }
          if (!s.value) return ''
          return `<div class="gen-row"><div style="min-width:0"><strong>${esc(s.label || s.canonical)}</strong>
            <div class="muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px">${esc(s.value)}</div></div>
            <button class="secondary" data-copy="${esc(s.value)}" data-canonical="${esc(s.canonical)}">Copy</button></div>`
        })
        .join('')
    results.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        await navigator.clipboard.writeText(btn.dataset.copy ?? '')
        btn.textContent = '✓'
        setTimeout(() => (btn.textContent = 'Copy'), 1200)
        reportUsage(form_fingerprint, [{ canonical_field: btn.dataset.canonical ?? 'UNKNOWN', action: 'copied' }])
      }),
    )
    document
      .querySelector('#do-autofill')
      ?.addEventListener('click', () => void runAutofill(tabId, suggestions, form_fingerprint))
  } catch (err) {
    status.textContent = `⚠ ${(err as Error).message}`
  }
}

async function runAutofill(tabId: number, suggestions: FieldSuggestionLite[], fingerprint = ''): Promise<void> {
  const status = $('#scan-status')
  const results = $('#scan-results')
  const btn = document.querySelector<HTMLButtonElement>('#do-autofill')
  if (btn) btn.disabled = true
  status.textContent = 'Filling the form…'
  try {
    const { outcomes } = (await chrome.tabs.sendMessage(tabId, { type: 'autofill', suggestions })) as {
      outcomes: FillOutcomeLite[]
    }
    const filled = outcomes.filter((o) => o.status === 'filled')
    const attempted = outcomes.filter((o) => o.status !== 'skipped')
    status.textContent = `✓ Filled ${filled.length}/${attempted.length} fields — review everything, then submit yourself.`
    const canonicalOf = new Map(suggestions.map((s) => [s.selector, s.canonical]))
    reportUsage(
      fingerprint,
      filled.map((o) => ({ canonical_field: canonicalOf.get(o.selector) ?? 'UNKNOWN', action: 'copied' as const })),
    )
    const ICON: Record<FillOutcomeLite['status'], string> = { filled: '✓', skipped: '○', failed: '⚠', not_found: '⚠' }
    const COLOR: Record<FillOutcomeLite['status'], string> = {
      filled: '#16a34a',
      skipped: '#94a3b8',
      failed: '#d97706',
      not_found: '#d97706',
    }
    results.innerHTML = outcomes
      .map(
        (o) => `<div class="gen-row"><div style="min-width:0">
          <strong style="color:${COLOR[o.status]}">${ICON[o.status]} ${esc(o.label)}</strong>
          ${o.reason ? `<div class="muted">${esc(o.reason)}</div>` : ''}
          ${o.status === 'filled' && o.value ? `<div class="muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px">${esc(o.value)}</div>` : ''}
        </div></div>`,
      )
      .join('')
  } catch (err) {
    status.textContent = `⚠ Autofill failed: ${(err as Error).message}`
    if (btn) btn.disabled = false
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// re-render when the user switches tabs or the page navigates
chrome.tabs.onActivated.addListener(() => void render())
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.status === 'complete') void render()
})

void initSettings().then(render)
