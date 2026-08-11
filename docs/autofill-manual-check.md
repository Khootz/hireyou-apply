# Manual check — autofill on corporate application sites

> **Scope pivot 2026-08-11:** JobsDB and CTgoodjobs are abandoned (easy-apply platforms, nothing
> to showcase). The target is **individual corporate careers sites** — IBM, Deloitte, and any
> company's own application flow. Nothing site-specific was ever needed: **Scan this page works on
> any http(s) page**, and the fill engine is machine-verified against real captured forms from
> three corporate ATS families: **Greenhouse** (Anthropic's form), **Lever** (Palantir's form),
> and **OKX**'s careers site (`npm run verify:m9`, 84 tests green).

## How it works (so you know what you're checking)

1. **Scan** — the content script walks every visible input/textarea/select on the page and
   resolves each field's label (label-for → aria → wrapping → nearby text → placeholder).
2. **Classify** — ~30 deterministic rules name the classics (name, email, phone, LinkedIn,
   university, notice period…) with zero LLM; one batched cheap-model call handles the leftovers;
   results are cached per form shape. Demographic/EEO fields classify to a hard do-not-fill bucket.
3. **Answer** — contact fields copy from your profile; derived facts (current title/company,
   university, degree) come from your latest profile entries, never generated; your 14 saved
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
4. `localhost:5180` → **Autofill answers** → fill all 14.

## Test 1 — Greenhouse or Lever, no login needed (~5 min, the demo)

These are the exact form families the machine evals run on:

- **Greenhouse**: any `job-boards.greenhouse.io` / `boards.greenhouse.io` posting → **Apply**.
- **Lever**: any `jobs.lever.co/<company>/<id>/apply` page (Palantir, Octopus Energy, …).

Side panel → **Scan this page** → **⚡ Autofill**. Expect: contact + URL fields fill and stay
filled, the university/referral dropdowns select or say "pick manually", EEO questions show the
amber "never suggested" row, saved answers appear for their questions.

## Test 2 — IBM, Deloitte, any corporate portal (~15 min, the frontier)

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

Known limits (documented, not surprises): no iframe/shadow-DOM traversal, radio groups are never
auto-picked, file uploads are never touched.

## Optional: confirm telemetry landed

```
npx tsx -e "const D=require('better-sqlite3');const db=new D('apps/api/data/app.sqlite');console.table(db.prepare('SELECT canonical_field,action,created_at FROM field_suggestion_events ORDER BY created_at DESC LIMIT 10').all())"
```
