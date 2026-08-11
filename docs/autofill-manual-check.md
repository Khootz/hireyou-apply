# Manual check — autofill on corporate application sites

> **Scope pivot 2026-08-11:** JobsDB and CTgoodjobs are abandoned (easy-apply platforms, nothing
> to showcase). The target is **individual corporate careers sites** — IBM, Deloitte, and any
> company's own application flow. Nothing site-specific was ever needed: **Scan this page works on
> any http(s) page**, and the fill engine is machine-verified against real captured forms from
> three corporate ATS families: **Greenhouse** (Anthropic's form), **Lever** (Palantir's form),
> and **OKX**'s careers site, plus **MokaHR** (PwC's form) (`npm run verify:m9`, 129 tests green).

## How it works (so you know what you're checking)

1. **Scan** — the content script walks every visible input/textarea/select on the page and
   resolves each field's label (label-for → aria → wrapping → nearby text → placeholder).
2. **Classify** — 55 deterministic rules name the classics (name, email, phone, LinkedIn,
   university, notice period…) with zero LLM; one batched cheap-model call handles the leftovers;
   results are cached per form shape. Demographic/EEO fields classify to a hard do-not-fill bucket.
3. **Answer** — contact fields copy from your profile; derived facts (current title/company,
   university, degree) come from your latest profile entries, never generated; your 39 saved
   answers cover the questions no resume answers; free-text essays are only drafted when the job's
   JD is attached, grounded in profile facts.
4. **Fill + verify** — values are written the way React apps expect, then read back from the DOM;
   anything a framework reverts gets a keyboard-simulation retry; comboboxes are driven like a
   human (type → menu filters → click the option). Checkboxes, radios, and file uploads are
   reported but never touched. **Nothing is ever submitted** — the Submit button is always yours.

## Setup (once)

1. `Start HireYou Apply.bat` (API :3100, web :5180).
2. `npm run build:extension`, then `chrome://extensions` → HireYou Apply → **⟳ Reload**.
3. Extension ⚙: API URL `http://127.0.0.1:3100`, token = `API_AUTH_TOKEN` from `.env`.
4. `localhost:5180` → **Autofill answers** → fill all **39** (grouped: Identity, Links, Work
   eligibility, Availability & pay, Education, Experience, Languages & skills, Employer
   questions). Make sure your **profile has a location** — it feeds Location/Country fields.
   **Fixed-choice questions are dropdowns now.** Yes/No questions come pre-loaded; for everything
   else the extension **harvests the real option lists while scanning**: scan the actual form
   once (even before answering anything), then revisit the answers page — the questions that are
   dropdowns on that form now offer its exact choices, labeled "choices captured from <site>".
   Pick from those and the fill match is guaranteed. Every dropdown keeps a **Custom answer…**
   escape for forms that word things differently. Dates: use `2026-06-30` style — year/month
   split widgets extract the right part automatically.
5. For essay questions ("Why do you want to work at X?"): **save the job first** (Add Job with the
   JD pasted, or via the extension), then pick it in the panel's **"Tailor essay answers to a
   saved job"** dropdown before scanning. No job selected = essays honestly left blank.

## Test 1 — the Palantir/Lever full-autofill demo (~10 min)

This exact form is machine-verified END-TO-END with live-recorded LLM output — 16 fields fill,
including the Yes/No radio questions.

1. Save the job: `localhost:5180` → **Add Job** → title/company + paste the JD from
   `jobs.lever.co/palantir/<any posting>`.
2. Open that posting → **Apply for this job**.
3. Side panel → pick the Palantir job in the dropdown → **Scan this page** → **⚡ Autofill**.
4. Expect ALL of this to fill: name, email, phone, location, current company,
   LinkedIn/GitHub/Portfolio, preferred name, name pronunciation, university dropdown,
   "how you heard", **"Are you legally authorized to work…" → Yes clicked**,
   **"Will you require sponsorship…" → No clicked**, proudest accomplishment, the
   "Why Palantir?" essay, and Additional information.
5. Expect to stay untouched: the language checkboxes, the AI-notetaker consent, and the marketing
   consent — consents are yours, always.

## Test 2 — Greenhouse, no login needed (~5 min)

Any `job-boards.greenhouse.io` / `boards.greenhouse.io` posting → **Apply** (Anthropic's form is
the machine eval). Same flow. Expect: contact + Country fill, react-select dropdowns get driven
or say "pick manually", EEO rows amber.

## Test 3 — PwC on MokaHR (Chinese campus-recruitment ATS)

Built from the transcribed question list **plus your full-page DOM capture** of the live form
(MokaHR is unreachable from this machine — your browser session is the only way in). The capture
revealed MokaHR "selects" are ARIA-free text inputs inside a widget shell — the filler now
**clicks them open and drives the menu like a human** instead of typing into them, and verifies
via the widget's display value. MokaHR also parks each closed menu in the DOM, so a **scan
harvests every dropdown's real choices** — after one scan of the PwC form, the answers page
offers its exact option wordings for citizenship, proficiencies, ranking, referral channel, and
the rest. **Recommended order: scan the PwC form first, then fill the answers page, then
autofill.** With the 39 answers filled, expect to fill:
programme/other-opportunities/visa selects, Chinese + English name variants, preferred English
name, mobile (**local number only** — the +852 goes into the code select now), citizenship +
status, current country, school country, major (+ major type), academic ranking,
department, employee type, responsibilities (from your latest profile role), the three language
proficiencies, English exam, skill, professional qualification, the b–e legal declarations,
related-to-employee, previously-employed, and referral channel.

Stays manual **by design**: Gender, Date of Birth, the criminal-proceeding and conviction
questions, and the accuracy-confirmation checkbox. Stays manual as a **known limit**: the
**graduation-date (and any other) calendar pickers** — they're readonly picker widgets, not
selects; their open-state DOM was never captured, so the filler leaves them alone. If you want
them driven, capture the page again with a picker **open** (F12 →
`copy(document.documentElement.outerHTML)`) and paste it in. Repeating "Add" sections (second
education period, awards): click Add first, then **re-scan** — new fields only exist after they
render.

## Test 4 — IBM, Deloitte, any corporate portal (~15 min, the frontier)

Big-corporate careers run on a handful of ATS platforms under the hood — the flow is always the
same: get to the actual form page (usually after creating an account), then **Scan this page** on
every step.

What to expect per family:

| ATS (who uses it) | Expectation |
|---|---|
| Greenhouse / Lever | Proven by machine eval — should just work |
| Workday (many Fortune 500) | Multi-step wizard: scan **each step** separately; heavy custom dropdowns — some will need manual picks |
| SuccessFactors / Taleo / iCIMS (common at Big-4 and old-guard corporates) | Forms sometimes live inside an **iframe** — if you see fields but scan says "No form fields found", that's the iframe limit; report the URL |
| Anything else | Scan it anyway — discovery is generic DOM |

Checklist per page:
- [ ] Fields fill and **stay** filled (watch for a revert ~1s after the green flash)
- [ ] Dropdowns select correctly or honestly report "pick it manually"
- [ ] EEO/demographic questions stay untouched with the amber note
- [ ] Saved answers land in their matching questions
- [ ] Multi-step wizards: re-scan on every new step
- [ ] Nothing submitted by itself

**Don't press Submit unless you genuinely want to apply.**

## Report back — every miss becomes a regression test

The Palantir capture alone surfaced and fixed three classifier bugs, so this loop works. For any
page that misbehaves:

1. `F12` → Console → `copy(document.documentElement.outerHTML)`
2. Paste into `tests/fixtures/forms/<company>-apply.html`
3. Tell me the URL, what you expected, what happened.

Known limits (documented, not surprises): no iframe/shadow-DOM traversal, checkboxes and consent
questions are never auto-ticked, file uploads are never touched. Radio groups with a clear saved
answer (work authorization, visa) ARE picked; anything ambiguous is left for you.

## Optional: confirm telemetry landed

```
npx tsx -e "const D=require('better-sqlite3');const db=new D('apps/api/data/app.sqlite');console.table(db.prepare('SELECT canonical_field,action,created_at FROM field_suggestion_events ORDER BY created_at DESC LIMIT 10').all())"
```
