# PROGRESS — loop state

Read PLAN.md first. One milestone per loop. Update this file every loop.

| Milestone | Status | Loops used | Verifier |
|---|---|---|---|
| M0 Scaffold + harness | **DONE** (machine checks green; manual: load extension in Chrome pending user) | 3 | `npm run verify:m0` |
| M1 Master profile | **DONE** (machine checks green; manual: editor walkthrough pending user) | 1 | `npm run verify:m1` |
| M2 CV PDF pre-fill | **DONE** (real CV parses: contact exact, 6 typed sections; review dialog gates apply) | 2 | `npm run verify:m2` |
| M3 Job tracker | **DONE** | 1 | `npm run verify:m3` |
| M4 Generation engine | **DONE** (provenance gate caught a real hallucination live; alias fix) | 2 | `npm run verify:m4` |
| M5 PDF rendering | **DONE** (system Chrome via puppeteer-core; preview = actual PDF) | 1 | `npm run verify:m5` |
| M6 Extension + HKUST | **DONE** (manual: load dist/ + live board check pending user) | 1 | `npm run verify:m6` |
| M7 Email apply | **DONE — live send verified** (real Gmail → test inbox, 2 PDFs, 2026-08-10) | 3 | `npm run verify:m7` |
| M8 Form hints (best-effort) | **DONE** (manual: live JobsDB/CTgoodjobs check pending user) | 1 | `npm run verify:m8` |
| M9 Hardening | **DONE** (manual: JobsDB/CTgoodjobs live walk pending user — `docs/autofill-manual-check.md`) | 2 | `npm run verify:m9` |
| M-UI Amploy UI parity | **DONE** (visual check pending user) | 1 | `npm run verify:m-ui` |

## Pre-build log

**2026-08-10 — planning session**
- Idea brief confirmed with user (see PLAN.md §1 and Claude memory `amploy-rebuild-brief`).
- HKUST fixtures captured while session cookie was live: `tests/fixtures/hkust/` — list-page-1.html (20 rows), detail-86585/86643/86638.html. detail-86585 = Quant Researcher Intern @ Jain Global, apply email present.
- DeepSeek key verified against `/models`: `deepseek-v4-flash`, `deepseek-v4-pro` available.
- `.env` created (gitignored), `.env.example` committed pattern.

## Loop log

**2026-08-10 — M0, loops 1–3 → GREEN (verify:m0 exit 0; 15 passed, 1 skipped)**
- Loop 1: full scaffold (43 files). FAIL: happy-dom fetched fixture stylesheets → unhandled rejections.
- Loop 2: disabled resource loading, then sanitized `<link>/<script>`. Tests passed but happy-dom still errored; upgrade to happy-dom 20 then **truncated the board's legacy nested-table HTML (6/57 anchors parsed)** → swapped harness to **jsdom** (parse5 = Chrome's HTML algorithm). Clean.
- Loop 3: live DeepSeek smoke initially failed — discovered machine-wide `HTTP(S)_PROXY=127.0.0.1:10808`; Node fetch ignores it. Fixed LLM client with undici `ProxyAgent`. Live roundtrip green. Dep bumps (drizzle 0.44, vite 8, vitest 4) → 0 audit vulnerabilities.
- Learned (matters for later milestones): all outbound HTTP must be proxy-aware (M2 parse, M4 generation fine — they go through the LLM client; M7 SMTP needs SOCKS tunnel); jsdom is the fixture parser of record, do not use happy-dom on HKUST HTML.
- Manual checklist remaining for user: `chrome://extensions` → Load unpacked → `apps/extension` → icon click opens the M0 side panel.
- Blocker for M7 (not M1–M6): Gmail app password for 199ktz@gmail.com (regular password rejected, verified).

**2026-08-10 — M1, loop 1 → GREEN (verify:m1 exit 0; 23 passed, 1 skipped)**
- Schema made draft-friendly (empty contact/text allowed; completeness enforced at M4 generation instead). Empty id/fact_id = "assign me" → server backfills UUIDs once, never regenerates existing ones.
- master_profile table (single row, JSON columns), GET/PUT /api/profile, normalization rewrites `order` = array index.
- Web: Tailwind v4, My Resume editor (contact card, three section types, add/remove/rename, ▲▼ reorder, 800ms autosave with status badge). Editor generates ids client-side so autosave responses need no adoption.
- Exit criteria all machine-verified: round-trip deep-equal, 400 on invalid, draft accepted, backfill, fact_id stability across edits, reorder persistence, auth required. Real-boot smoke: PUT/GET over HTTP with backfilled UUIDs confirmed; web `vite build` clean.
- Manual checklist for user: run `npm run dev:api` + `npm run dev:web`, open http://localhost:5180, fill some profile, refresh — data persists.

**2026-08-10 — M2, loops 1–2 → GREEN (28 tests: 27 passed, 1 skipped)**
- cvExtract: pdfjs line-grouping + two-column detection (midline whitespace band). Real CV: 1 page, 224 runs, clean extraction.
- cvParse: flash-tier structuring, verbatim-preservation prompt, returns DRAFT only (never persists). Live-recorded fixture `cv-parse.json` from user's real CV — quality excellent (contact exact; EDUCATION incl. DTU exchange, WORK EXPERIENCE 2 orgs × 4 bullets, AWARD HIGHLIGHTS 5 entries, LEADERSHIP, SKILLS).
- Route POST /api/profile/parse-cv (multipart ≤2MB → 413 above limit, %PDF- magic check → 400, parse failure → 422).
- Web: Upload-CV button + review dialog (checkbox per section + contact merge, replace-warning when sections exist).
- Loop 2 fix: oversized-file expectation 400→413 (multipart limit fires before route handler — correct HTTP semantics).
- Refresh fixture anytime with `npx tsx scripts/record-cv-parse.ts`.

**2026-08-10 — M3, loop 1 → GREEN (34 passed)**
- jobs table + CRUD API; dedup_key = (board, lowercased company, lowercased title) — URL-agnostic, unique index. applied_at stamped on first transition to applied only; notes edits don't touch status_updated_at.
- Web: react-router-dom; Jobs list (Title/Company/Status/Materials/Date, +Add Job modal, relative dates), Amploy-style job detail (status pills, JD, autosaving notes, delete).

**2026-08-10 — M4, loops 1–2 → GREEN (41 passed)**
- Architecture: LLM returns a PLAN referencing profile facts by alias (s1/e2/b14 — models mangle UUIDs); server translates aliases → real fact_ids, rebuilds the document from the PROFILE (org/role/dates structurally uncopyable from model output), throws GenerationValidationError on any unresolvable reference.
- Loop 1 live-recording caught a REAL hallucinated fact_id in SKILLS — gate works. Fix: alias ids + one business-retry with the violation fed back. Re-record clean: resume 6 sections/22 bullets, cover letter names "Jain Global" + "Quant Researcher Intern" in p1.
- Async Runner (queued→running→succeeded/failed, drain() for tests), versioning (regenerate = v2, v1 kept), idempotent generate (active run returned), readiness gate 422 (profile/JD completeness enforced here, not at autosave).
- Fixtures: tests/fixtures/generation/{profile.json (frozen fact_ids), jain-jd.txt}; llm/{tailor-resume, cover-letter, tailor-bogus(-retry)}. Re-record: `npx tsx scripts/record-generation.ts`.
- Web: generation cards on job detail (generate → poll → version list), document viewer.

**2026-08-10 — M5, loop 1 → GREEN (44 passed)**
- puppeteer-core + system Chrome (channel:'chrome') — no bundled-Chromium download (Google-hosted, would need proxy anyway). HTML templates: serif/justified/hyphenated, ruled section headers, two-col entry rows, centered name block.
- GET /api/documents/:id/pdf renders on demand, caches by (id, version) — content immutable per version. Query-token auth (?token=) for iframes/new tabs, GET-only.
- Tests assert: %PDF magic, selectable text (name/section/org found via pdfjs), identical text + page count across two renders, 401 without token. Preview iframe shows the SAME rendered PDF — parity by construction.

**2026-08-10 — M6, loop 1 → GREEN (48 passed)**
- Full HKUST extractor: title/jp from <title>, company+deadline from table.large-view label/value column alignment, JD = cleaned .career-content text (≤4000), mailto apply email. All 3 fixtures extract cleanly; null on non-detail pages.
- Real MV3 build (esbuild IIFE → dist/, load THAT unpacked): content-hkust.js (auto-detect on job_detail pages), sw.js (per-tab job registry in chrome.storage.session — MV3 workers die between events), panel.js (vanilla TS: settings gear for API URL/token, job card, ✓ SAVED banner via /api/jobs/match dedup lookup, status dropdown, Generate buttons with polling, View in HireYou link).
- API: @fastify/cors (extension origin), GET /api/jobs/match.

**2026-08-10 — M7, loops 1–2 → GREEN (53 passed) — live send pending app password**
- SAFE_MODE contract: recipient override INSIDE sendApplicationEmail (resolveRecipient) — hostile `to:` payload test proves it can't be bypassed; EmailRecord audits to_intended vs to_actual. Defaults ON (anything but explicit "false").
- Nodemailer over socks5://127.0.0.1:10808 (SMTP_PROXY; direct SMTP egress blocked on this machine). Transport is a test seam (fake transport captures sendMail; attachments verified as real rendered PDFs on disk).
- Draft builder: subject "Application for {title}", body adapted from user's 2025 emails.py skeleton, attachments = latest resume + cover letter versions. Web: Apply-by-email card (editable to/subject/body, SAFE MODE banner, attachment chips, sent history, Mark-as-Applied prompt).
- Loop 2 fix: @types/nodemailer lacks `proxy` option — cast. REMAINING: real Gmail send once user supplies app password for 199ktz@gmail.com (then: set SMTP_APP_PASSWORD in .env, run a send, check tzkhoo@connect.ust.hk inbox).

**2026-08-10 — M8, loop 1 → GREEN (59 passed)**
- packages/shared/autofill.ts: discovery (visible inputs/textarea/select, label chain label[for]→aria→wrapping→preceding-text→placeholder, maxlength/options capture) + tier-1 rules (~20 canonical fields, autocomplete map). SENSITIVE_DO_NOT_FILL beats every other signal incl. autocomplete; matches labels AND option lists.
- API POST /api/autofill: tier-2 = ONE batched flash call for unknowns; answers routed: direct-copy (contact/paragraph links), derived (current_title/company from latest experience entry — never generated), generative (ONE batched strong call, maxlength enforced server-side), sensitive → null + refusal note, unknown → honest null.
- Extension: content-hints.js on *.jobsdb.com / *.ctgoodjobs.hk — suggestions render as PLACEHOLDER text (grey hint, zero value injection, framework-input problem structurally avoided), blue outline, count toast; panel "Fill application" → scan → suggestions list with Copy buttons; sensitive fields shown with the refusal note.
- Live recording quality: 11/11 fields classified correctly incl. all 3 EEO blocked; generative answers grounded in real profile facts.
- Known limits (documented, accepted as best-effort): no shadow-DOM/iframe traversal, no radio-group option judgment, no submit detection on form path, JobsDB/CTgoodjobs real-page drift untested live.

**2026-08-10 — M7 close: LIVE SEND VERIFIED**
- `npx tsx scripts/live-send-test.ts` → real Gmail SMTP through socks5://127.0.0.1:10808, SAFE_MODE override active (intended APAC-Careers@jainglobal.com → actual tzkhoo@connect.ust.hk), 2 real PDF attachments. Sender: 1999ktz@gmail.com (app password in .env; NOTE: three 9s — 199ktz@ and 1999ktz3@ are wrong).
- Also live: web UI deployed to https://hireyou-apply.vercel.app (static; calls the local API — browsers treat 127.0.0.1 as secure). One-click local boot: "Start HireYou Apply.bat". Vercel CLI on this machine needs `NODE_USE_ENV_PROXY=1`.
- P0 IS COMPLETE: every stage of the HKUST flow has now run for real at least once.

**2026-08-10 — M-UI, loop 1 → GREEN (62 passed) — from user's Amploy screenshots**
- Nav: HireYou wordmark, icon tabs with active pill, avatar initials from profile, Install Extension page (load-unpacked steps; Web Store unlisted deferred). NO pro/billing UI per user.
- Jobs page: "N jobs tracked", status filter pills with live counts, search (title/company), inline status dropdown + colored dot, real Materials chips (jobs list now returns `materials` via GROUP_CONCAT over documents), row × delete, title ↗ link.
- My Resume: two-pane — left editor with ⠿ HTML5 drag-reorder (+▲▼ kept), right sticky LIVE PDF preview via GET /api/profile/pdf (master profile through the SAME renderer as exports; cached by updated_at; /meta returns page count; refreshes after each autosave). Empty-profile render tested.
- Redeployed to Vercel. Also earlier same day: fixed dev boot (tsx watch hangs under concurrently on Windows → plain tsx; `dev:api:watch` kept for code work) and made the launcher self-healing (health-check, kill half-dead, wait-until-ready).

**2026-08-10/11 — interim (user-driven upgrades between M-UI and M9, committed without loop entries)**
- Add Job dialog rebuilt to Amploy format (dea42d4); resume editor visible drag-reorder (110d3e3); autofill promoted from grey hints to REAL FILL on any http(s) page with fill→verify→retry loop, combobox driving, application-answers store, classification cache (ec77277); resume PDF one-page auto-fit (77e0b0f). Real captured Greenhouse (Anthropic) + OKX forms added as fixture evals.

**2026-08-11 — M9, loops 1–2 → GREEN (verify:m9 exit 0; 78 passed, 1 skipped)**
- Loop 1 (2c59df9): prompt-injection fencing for untrusted JD text (sanitized delimiters, lookalike defusal); LlmProviderError separates provider outages from validation failures — no retry on outages, honest surface, degraded results never cached.
- Loop 2: **suggestion telemetry** — /api/autofill returns form_fingerprint; POST /api/autofill/events (copied/dismissed/ignored, zod-gated, batch ≤100) writes field_suggestion_events; panel reports Copy clicks + autofill-filled fields fire-and-forget (canonical name + action only, never values). **Key-rotation reminder** — app_meta stores sha256(secret)+first_seen (never the secret) for DEEPSEEK_API_KEY/SMTP_APP_PASSWORD/API_AUTH_TOKEN; unchanged hash past 30 days (KEY_ROTATION_REMIND_DAYS) surfaces in /health.key_rotation_due + boot console.warn; rotated key silently restarts the clock.
- Also this loop (user ask): **answers page 9 → 14 questions** — expected_start_date, current_salary, willing_to_relocate, languages, highest_education_level added as canonicals + deterministic rules (current_salary ordered before salary_expectation; highest_education_level before degree/institution rules).
- Manual checklist for user: `docs/autofill-manual-check.md` — live JobsDB/CTgoodjobs walkthrough (probe 2026-08-11: jobsdb refuses non-browser clients even via proxy, ctgoodjobs bot-blocks CLI — extension-in-Chrome is the only viable path, fixtures must come from the user's session).

**2026-08-11 — CTgoodjobs live regression → GREEN (80 passed, 1 skipped)**
- User's first live CTgoodjobs scan failed: `400 fields: Array must contain at most 100 element(s)` — their pages carry 100+ filter checkboxes that out-shout the apply form. Fix: `prioritizeFields` in shared (fillable text/select/textarea controls keep their place, checkbox/radio noise falls off past the cap, `MAX_AUTOFILL_FIELDS` shared between panel and route schema); panel says "asking about the N most fillable" when trimming. Regression test = synthetic 120-checkbox sidebar + real form: raw scan 400s, prioritized batch 200s with all 5 fillable fields kept in document order.
- JobsDB dropped from the manual checklist per user (easy-apply, doesn't showcase); guide now leads with CTgoodjobs + public Greenhouse forms (no login, same form family as the machine eval) as the demo path.
- Flake hardening: global vitest hookTimeout 30s / testTimeout 15s (Chrome shutdown + pdfjs exceeded 10s/5s defaults under parallel load — 3 different suites flaked on a loaded machine, all pass in isolation).

**2026-08-11 — SCOPE PIVOT: corporate ATS sites (user decision) → GREEN (84 passed, 1 skipped)**
- JobsDB + CTgoodjobs ABANDONED as autofill targets (easy-apply, nothing to showcase). New target: individual corporate application sites (IBM, Deloitte, any company's own flow). PLAN.md §1 addendum records it.
- Engine was already site-agnostic (content script on all http(s) + on-demand injection). New machine proof: **real Palantir apply form captured live from Lever** (jobs.lever.co, via undici through the proxy — curl exits 43 on this box, use node/undici for captures) → `tests/fixtures/forms/lever-apply.html` + `autofill-lever.test.ts` eval (discover → classify → suggest → fill → verify; 8 core fields + university/referral/why-company/cover-letter all deterministic, generative fields null without job context, empty profile location honestly skipped).
- The capture surfaced 3 live classifier bugs, all fixed + regression-locked: "Telugu (TEL)" checkbox → phone (tick-boxes now classify only to SENSITIVE/UNKNOWN and are excluded from the tier-2 LLM batch — they're never filled, so value canonicals are always wrong); "How do you pronounce your name?" → full_name (pronounc guard); "how you heard about" missing the referral rule (Lever phrasing).
- Corporate ATS eval coverage now: Greenhouse (Anthropic), Lever (Palantir), OKX. Guide rewritten corporate-first with per-ATS expectations (Workday multi-step = scan per step; SuccessFactors/Taleo iframes = known limit).

**2026-08-11 — FULL AUTOFILL on the Palantir/Lever example (user ask) → GREEN (85 passed, 1 skipped)**
- **Radio groups are now one field carrying the real question** (pre-pass grouping by name, question via preceding-text/legend walk, options from per-option labels) → classify (work_authorization / visa_sponsorship_required on the real form) → **fill from saved answers** via progressive matchOption (exact → answer-starts-with-option → …), verified by which radio is checked. Consent radios stay untouched (UNKNOWN → no value by design). Checkbox guard unchanged.
- Answers page 14 → **17**: preferred_name (also derived from first name), name_pronunciation, proudest_accomplishment (saved answer wins, generative with job context otherwise). location rule += country (Greenhouse's Country field).
- **Panel job-context picker**: "Tailor essay answers to a saved job" dropdown (GET /api/jobs) feeds job_id to /api/autofill so why_this_company/cover_letter/additional_info actually generate.
- Live-recorded LLM fixtures on the real Palantir form (`scripts/record-lever-autofill.ts`, JD fetched live → tests/fixtures/generation/palantir-jd.txt): **16 fields fill** — everything honestly answerable; only checkboxes, consents, and (empty-profile) location stay blank. "Why Palantir?" output grounded in profile facts. Lever eval now asserts full coverage + DOM-checked radios; no-job run asserts essays stay null (no hallucinated enthusiasm).

**2026-08-11 — PwC/MokaHR vocabulary (user's live transcription) → GREEN (128 passed, 1 skipped)**
- MokaHR unreachable from this machine (proxy + direct both fail) — the user's pasted question list IS the fixture (autofill-pwc.test.ts, 43 tests, every label asserted).
- Answers page 17 → **39**, grouped (Identity/Links/Work eligibility/Availability & pay/Education/Experience/Languages & skills/Employer questions). New canonicals: Chinese name variants, citizenship(+status), country_of_birth, school_country, major, academic_ranking, department, employee_type, english/mandarin/cantonese proficiency, english_exam, skills, professional_qualification, programme_interest, open_to_other_opportunities, previously_employed_here, related_to_employee, legal_declarations; derived: phone_country_code, responsibilities (latest role bullets).
- Live-run misfires fixed + regression-locked: English "KHOO" filled the CHINESE family-name field (chinese-name rules before name rules); user's email filled "related to a PwC partner… provide PwC email" (related_to_employee before email); "Do you REQUIRE work authorisation or visa" inverted to work_authorization (require-rule → visa_sponsorship_required first); mobile truncation (split-phone: code select gets +852, number field gets local part); "certificates of graduation…school transcript" hit the school rule (graduation before education rules).
- Date-part selects: year/month split widgets extract the right part from "2026-06-30"/"Jun 2026" answers — the generic substring fallback matched the "2" in "2026-06-30" to month 2 (found by test, fixed: date-part match is exclusive when options look like date parts). verifyFill accepts date-part selections.
- Hard-blocked by design (stated to user): Gender, DOB, criminal/conviction declarations, consent checkboxes.

(append entries here: date, milestone, attempt #, changes, verifier output, next action)
