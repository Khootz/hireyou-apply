# HireYou Apply — Build Plan

**What:** Standalone recreation of amploy.app's two core features — AI-tailored resume/cover-letter generation and job-application autofill assist — built for future integration into HireYou 2.0.
**Method:** Loop engineering. One milestone per loop. Each loop has a machine-runnable **verifier**, persistent **state** (PROGRESS.md + git), and **stop conditions** (exit criteria pass, or 4 failed attempts → surface the blocker to the user instead of thrashing).
**Source docs:** `amploy-technical-build-spec.md`, `amploy-teardown-prd.md` (Downloads), confirmed Idea Brief 2026-08-10.

---

## 1. Scope contract (locked with user)

**P0 — must work end-to-end:** HKUST career board (`career.hkust.edu.hk`).
Flow: student opens a real posting → extension detects it → job saved to tracker (title, company, JD, apply email, deadline) → tailored resume + cover letter generated → PDFs rendered → application email previewed on the job page → **Send** delivers to test inbox.

**Best-effort:** JobsDB + CTgoodjobs grey-hint field suggestions. If their apply flows resist (external redirects, login walls), acceptable landing = JD extraction + materials generation, no form hints. Amploy itself pivoted away from these boards; do not sink loops here.

**Hard rules (from teardown, non-negotiable):**
1. Never auto-submit anything. Suggestions only; the student is always the hands.
2. Suggestion-first autofill: grey hint text rendered near/in fields, **no value injection** in v1 (sidesteps the React-controlled-input trap entirely).
3. Tailoring never invents facts: no new employers, titles, dates, metrics, credentials. Enforced structurally (see §5), not by prompt hope.
4. `SENSITIVE_DO_NOT_FILL` classification bucket: demographic/EEO fields get **no suggestion ever**.
5. DeepSeek key lives server-side only. Extension → our API → DeepSeek. Never in extension code.
6. Email sending: `SAFE_MODE=true` hard-overrides every recipient to `tzkhoo@connect.ust.hk` (user's mock receiver) inside the send function itself (not at call sites). Sender: `199ktz@gmail.com`. User does not want real applications sent yet.

**Explicitly out of v1:** billing/credits, referrals, marketing site/SEO, multi-user auth (single bearer token), Greenhouse/Lever/Workday/LinkedIn, Chinese output, Tab-to-accept injection, mobile.

---

## 2. Stack (decided)

| Layer | Choice | Why |
|---|---|---|
| Monorepo | npm workspaces | zero extra tooling on Windows |
| API | Node 20 + TypeScript + Fastify + zod | schema validation everywhere; boring and fast |
| DB | SQLite via Drizzle ORM + better-sqlite3 | single user, zero ops, typed schema, trivial backup |
| Web app | Vite + React + TS + Tailwind + shadcn/ui | mirrors HireYou2's stack → cheap future integration |
| Extension | MV3, TypeScript, Vite multi-entry build (service worker / content script / side panel in React) | thin client, mirrors Amploy's 88 KiB philosophy |
| LLM | DeepSeek: `deepseek-v4-flash` (cheap tier), `deepseek-v4-pro` (strong tier), OpenAI-compatible API, JSON mode | key verified working 2026-08-10 |
| PDF render | HTML templates → Puppeteer print-to-PDF; the preview pane displays the **rendered PDF itself** | preview/export parity for free (spec §7); selectable text for ATS |
| PDF parse (CV pre-fill) | pdfjs-dist text items with coordinates → reading-order heuristic → flash-model structuring | layout-aware, handles two-column CVs (spec §11.G) |
| Email | Nodemailer + Gmail SMTP app password, tunneled through local SOCKS proxy `127.0.0.1:10808` (`SMTP_PROXY`) | user's machine blocks direct SMTP egress (verified 2026-08-10); Google hosts only reachable via proxy; DeepSeek + HKUST reachable direct |
| Tests | Vitest; happy-dom for DOM extraction tests; pdf-parse for PDF assertions; recorded LLM fixtures by default, live smoke behind `LIVE_LLM=1` | deterministic verifiers, controlled spend |

**Model tiering (spec §6.4):** flash → CV structuring, JD parsing, field classification, select-option judgment. pro → tailored bullets, cover letter prose, free-text answers. Every LLM call: JSON mode + zod validation + one retry with validation error appended → then fail loudly.

---

## 3. Repo layout

```
hireyou-apply/
  PLAN.md  PROGRESS.md  README.md
  .env  .env.example  .gitignore
  package.json                    # workspaces root
  packages/shared/                # zod schemas + types: Profile, Job, Document,
                                  # canonical autofill fields, API DTOs, DOM extractors
  apps/api/                       # Fastify: routes, services, drizzle schema,
                                  # llm client, pdf renderer, mailer, async runs
  apps/web/                       # Jobs list/detail, My Resume editor, doc preview
  apps/extension/                 # manifest.json, service-worker, content scripts,
                                  # side panel (React)
  tests/fixtures/
    hkust/                        # captured 2026-08-10 (live session):
                                  #   list-page-1.html (20 job rows)
                                  #   detail-86585.html (Jain Global, has mailto)
                                  #   detail-86643.html, detail-86638.html
    forms/                        # static + React test forms for autofill (M8)
    llm/                          # recorded DeepSeek responses
    cv/                           # test resume PDFs (add user's real CV + 2 synthetic)
```

**HKUST DOM facts (verified against fixtures + user's 2025 scraper):** list rows `tr.job-item`, company/title in `font.font2` inside `td.detail-text.large-view`, detail URL `job_detail.php?jp={id}`, JD in `.career-content .detail-text` + `table.second-detail`, apply email as `a.red_link[href^="mailto:"]`, page `<title>` = `{Job Title}({jp}) | Career Center | The HKUST`. Extractors live in `packages/shared` and run identically in the content script (live DOM) and in Vitest (fixture HTML via happy-dom).

---

## 4. Data model (trimmed from spec §3)

- **MasterProfile** — contact `{full_name, email, phone, location}` + ordered `ProfileSection[]`; single row (single user).
- **ProfileSection** — `{id, order, title, type: paragraph|experience|bullets, content}`; every bullet/atom has a stable `fact_id` (provenance backbone).
- **Job** — `{id, title, company, location?, source_url, source_board: hkust|jobsdb|ctgoodjobs|manual, jd_text (≤4000 chars), apply_email?, deadline?, status: saved|applied|interviewing|offered|rejected, notes, timestamps}`; dedup key = normalized `(company, title, source_url)`.
- **Document** — `{id, job_id, type: resume|cover_letter, content (structured JSON, same section schema), version (increment, never overwrite), pdf_path?, created_at}`.
- **GenerationRun** — `{id, kind, status: queued|running|succeeded|failed, model, error?, timings}`; API returns run id, client polls.
- **EmailRecord** — `{id, job_id, to_intended, to_actual, subject, body, attachment_doc_ids, sent_at, safe_mode: bool}` — keeps the audit trail honest about the override.
- **FieldSuggestion telemetry (M8)** — `{form_fingerprint, canonical_field, action: copied|dismissed|ignored}`.

No CreditLedger, no plan/billing fields. Skipped deliberately.

---

## 5. Anti-hallucination design (the differentiator worth keeping)

1. Profile is a **closed set of atomic facts**; every bullet/entry carries `fact_id`.
2. Tailoring prompt outputs bullets each tagged `source_fact_id`.
3. Post-validation **rejects** any output bullet whose `source_fact_id` doesn't resolve, and any employer/title/date string not present in the profile (string + fuzzy check).
4. Cover letter: paragraph claims validated the same way; company + role must come from the Job row.
5. Reuse the 2025 `coverletter.py` insight: **fixed template with LLM-filled slots** for the email body and cover letter skeleton — the model fills bracketed gaps, it doesn't freestyle the document.
6. Autofill factual fields (`years_experience`, `graduation_date`, `work_authorization`…) are **computed/copied from profile, never generated**. Unknown → no suggestion.

---

## 6. Milestones (one loop each)

Verifier convention: `npm run verify:mN` — must exit 0. PROGRESS.md records each loop: attempt #, what changed, verifier output, next action.

**M0 — Scaffold + harness**
Workspaces, TS configs, Fastify skeleton with `/health` + bearer auth, Drizzle + SQLite migration, DeepSeek client (JSON-mode helper + zod validate + retry + fixture-record/replay mode), Vitest wired root-wide, extension hello-world loads in Chrome, PROGRESS.md started.
*Exit:* `npm run verify:m0` — typecheck + unit tests green; `/health` 200 with auth, 401 without; recorded-fixture LLM round-trip test passes; extension builds and loads (manual check, screenshot in PROGRESS.md).

**M1 — Master profile (form-first)**
Drizzle schema, CRUD API, My Resume page: contact block + section editor (paragraph/experience/bullets), add/remove/rename/reorder, autosave.
*Exit:* API tests for CRUD + reorder + validation; profile round-trips (create → reload → deep-equal); fact_ids stable across edits.

**M2 — CV PDF pre-fill**
Upload endpoint (PDF ≤2 MB), pdfjs extraction → reading-order text, flash-model structuring → **draft** profile diff the user reviews and confirms (never silently overwrites).
*Exit:* user's real CV + 2 fixture CVs (one two-column) parse with all sections present, no lost/duplicated bullets (fixture-based assertion against hand-labeled expected JSON); malformed PDF → clean error.

**M3 — Job tracker**
Job CRUD API + web: jobs list (Title/Company/Status/Materials/Date) + Amploy-style detail page (status pills, JD, notes, generation cards — clone the user's screenshot).
*Exit:* CRUD + status transition tests; dedup test (same job, two URL forms → one row); 4000-char JD cap enforced.

**M4 — Generation engine**
JD parse (flash) → tailor resume (pro) + cover letter (pro) with provenance tags; async GenerationRun + polling; versioning; validation gate from §5.
*Exit:* on fixture profile + Jain Global JD: every output bullet resolves to a `source_fact_id` (machine-checked); zero unknown employers/dates in output; cover letter names company + role; forced model failure → run `failed`, no partial document; regeneration bumps version, old version retained. Live-LLM smoke (2 calls) behind `LIVE_LLM=1`.

**M5 — PDF rendering + preview**
HTML templates (serif, justified, hyphenation, ruled headers, right-aligned dates — Amploy look), Puppeteer render, storage, web preview shows the actual PDF + download; deterministic output (fixed dates, no timestamps).
*Exit:* rendered PDF text is extractable and contains all section titles (pdf-parse assertion); same input → identical page count across two renders; resume + cover letter both render from M4 output.

**M6 — Extension + HKUST detection (P0 core)**
MV3 side panel (job card, status dropdown, Generate buttons, View in App link), token setup in options, content script detect+extract on `job_detail.php` pages using shared extractors, save-to-tracker, duplicate shows saved state.
*Exit:* extractor tests over the 3 HKUST fixtures assert exact title/company/apply-email/JD-prefix values; manual live check on the real board recorded in PROGRESS.md; save from panel → appears in web tracker without refresh; revisit → "saved" state, no dup row.

**M7 — Email apply (P0 finish)**
Compose from template + generated materials (subject `Application for {job_title}`, body = user's proven 2025 email skeleton with LLM-filled slots), attach rendered PDFs, preview panel on job detail page, Nodemailer send, EmailRecord audit, post-send prompt to mark Applied.
*Exit:* with SAFE_MODE=true a send addressed to any apply email lands in `1999ktz3@gmail.com` with 2 valid PDF attachments (manual inbox check + EmailRecord assertion `to_actual == SAFE_MODE_RECIPIENT != to_intended`); unit test proves override cannot be bypassed via API payload; send failure surfaces cleanly (no phantom "sent").
*Needs from user at loop start:* Gmail app password for the sending account.

**M8 — Best-effort form hints (JobsDB/CTgoodjobs/generic)**
Field discovery (visible inputs/textarea/select + label resolution priority chain), two-tier classification (deterministic rules ≈70% + one batched flash call), answer routing (copy/derived/generative per §5.6), grey-hint overlay + per-field copy button (no injection), sensitive blocklist, JD-extraction fallback when no form found.
*Exit (adapted spec §8.9):* static fixture form 7/7 classified; EEO fixture block → `SENSITIVE_DO_NOT_FILL`, no suggestion rendered; `maxlength` respected on generated answers; typing in a field never altered; unknown field → no suggestion; batched call count == 1 per form. Live JobsDB/CTgoodjobs check is best-effort — failures documented, not loop-blocking.

**M9 — Hardening (only if runway remains)**
Prompt-injection delimiting for JD/DOM text, form-fingerprint cache, suggestion telemetry, provider-error honesty, key rotation reminder.

**M-UI — Amploy UI parity (added 2026-08-10 from user screenshots)**
Brand: "HireYou" text logo, NO pro/upgrade features.
1. Nav: icon tabs (Jobs / My Resume / Install Extension), active-pill state, avatar initials from profile.
2. Jobs page: "N jobs tracked" subtitle, status filter pills with live counts, search by title/company, table with title↗ link, inline status dropdown + colored dot, real Materials chips (Resume/Cover from documents), relative date, row × delete.
3. My Resume: two-pane editor — left structured sections with DRAG-reorder (⠿ handle, HTML5 DnD) + ▲▼ fallback; right live PDF preview of the master profile (the actual rendered PDF, refreshed after each autosave) with page count.
4. Install Extension page: load-unpacked instructions (Web Store unlisted publish deferred to integration).
*API additions:* GET /api/profile/pdf (+ /meta page count) rendering the master profile through the SAME renderer as exports — preview parity by construction; jobs list gains `materials`.
*Exit:* profile-pdf endpoint tests (auth, %PDF magic, name+section text present, meta pages ≥1); jobs list materials test; typecheck + web build; visual parity = user manual check; redeploy to Vercel.

---

## 7. Loop protocol (per Karpathy: verifier / state / stop)

Each loop: read PROGRESS.md → implement milestone → run `npm run verify:mN` → paste verifier output into PROGRESS.md → commit (`M{N} loop {k}: <result>`).
- Verifier green → mark milestone done, stop, report to user.
- Verifier red → diagnose, fix, re-run. **Max 4 attempts per milestone**, then stop and surface the blocker with evidence instead of thrashing.
- Verifiers never call live LLM by default (recorded fixtures); live smoke suites are explicit and tiny.
- Manual-eyes steps (extension in real Chrome, inbox check) are listed in each milestone's checklist in PROGRESS.md — the user confirms those; everything else must be machine-checked.

## 8. Integration contract (for HireYou 2.0 colleague)

The API is the boundary: every feature callable via authenticated REST, zero UI coupling; `packages/shared` types are the vocabulary. Web app is disposable — HireYou 2.0 can re-implement screens against the same API. Extension already talks only to the API.

## 9. Risks & fallbacks

| Risk | Mitigation |
|---|---|
| **All outbound traffic must ride the local proxy** (`HTTP_PROXY`/`HTTPS_PROXY=127.0.0.1:10808` machine-wide; direct egress fails) | LLM client uses undici `ProxyAgent` reading proxy env vars (done, M0); any new outbound HTTP code must do the same; SMTP tunnels via SOCKS (M7) |
| JobsDB/CTgoodjobs apply flows gated/redirect | declared best-effort; JD-extraction fallback (locked with user) |
| HKUST board DOM drift / session expiry | fixtures captured 2026-08-10; extension runs in user's logged-in browser so no PHPSESSID handling; ask user for fresh cookie only to refresh fixtures |
| DeepSeek JSON reliability | JSON mode + zod + 1 retry-with-error; fixture-replay keeps tests deterministic |
| CV parse quality on real resumes | pre-fill is a reviewed draft, never authoritative; user confirms every field |
| Gmail SMTP quirks (app password, port blocks) | SAFE_MODE test path only needs one recipient; fallback = Resend free tier |
| Puppeteer on Windows CI-less env | render tests run locally; pin chromium via puppeteer's bundled build |
| Exposed secrets (DeepSeek key, OpenRouter key in old script, PHPSESSID) | .env gitignored from first commit; user rotates both keys after build |

## 10. Open items needing the user

1. **M7 (only remaining blocker):** Gmail **app password** for `199ktz@gmail.com` — regular password verified failing (535 Login denied). Enable 2-Step Verification → App passwords → Mail.
2. ~~M2: real CV PDF~~ — done, `tests/fixtures/cv/thien-zhi-cv.pdf` (2026-08-10).
3. **After build:** rotate the DeepSeek key, the old OpenRouter key (coverletter.py), and the Gmail password (all pasted in chat).
4. Repo name/location: currently `C:\Users\User\Desktop\hireyou-apply` — rename freely before first commit.
