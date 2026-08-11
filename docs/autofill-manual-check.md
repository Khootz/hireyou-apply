# Manual check — autofill on JobsDB / CTgoodjobs

The fill pipeline is already machine-verified end-to-end (discover → classify → suggest → fill →
read-back-verify) against **real captured application forms** (Greenhouse/Anthropic and OKX fixtures,
`npm run verify:m9` green). What only your eyes can prove: the two HK boards' live DOM — login walls,
iframes, bot defenses, and their particular dropdown widgets. This is that walkthrough.

> Heads-up from a network probe (2026-08-11): `hk.jobsdb.com` refuses non-browser connections from
> this machine even through the proxy, and CTgoodjobs bot-blocks plain HTTP clients. Neither affects
> you — the extension runs inside your normal Chrome session. It just means I could not pre-capture
> their forms for you; your session is the only way in.

## 0. Setup (5 min, do once)

1. **Start the stack** — double-click `Start HireYou Apply.bat` (or `npm run dev`).
   API: `http://127.0.0.1:3100`, web: `http://localhost:5180`.
2. **Rebuild + reload the extension** (this build adds usage telemetry + 5 new saved answers):
   - `npm run build:extension`
   - `chrome://extensions` → HireYou Apply → **⟳ Reload**
     (first time: Load unpacked → `apps/extension/dist`)
   - Click the extension icon → ⚙ → API URL `http://127.0.0.1:3100`, token = `API_AUTH_TOKEN`
     from `.env` → Save. Expect **"✓ Saved — API reachable"**.
3. **Fill the answers page** — `http://localhost:5180` → **Autofill answers**. It now has **14
   questions** (new: earliest start date, current salary, highest education level, languages,
   willing to relocate). Every answer you fill here autofills on any form that asks the matching
   question — aim for 14/14.

## Test A — JobsDB (~10 min)

1. Log into `hk.jobsdb.com` and pick any job with a **Quick apply** badge.
2. Click Quick apply → the application form loads (URL like `hk.jobsdb.com/apply/...`).
3. Open the HireYou side panel → **Scan this page**.
4. Expect: `N fields found — asking for suggestions…` → a suggestions list + **⚡ Autofill N fields**.
5. Click Autofill and watch: fields scroll into view one at a time with a green flash.
6. Checklist:
   - [ ] Name / email / phone filled and **stay** filled (not reverted a second later)
   - [ ] Dropdowns either select the right option or honestly say "pick it manually"
   - [ ] Any demographic/EEO question shows the amber "never suggested" row, field untouched
   - [ ] Employer questions (expected salary, notice period, languages, start date…) fill from
         your saved answers
   - [ ] Nothing submitted — the Submit button is still yours
7. **Do not press Submit** unless you genuinely want to apply to that job.

## Test B — CTgoodjobs (~10 min)

Same steps: log into `ctgoodjobs.hk`, open a job, click **Apply Now**. Their apply flow may hop to
`jobs.ctgoodjobs.hk` or open a new tab — run **Scan this page** on whichever page actually shows
the form fields.

## Honest failures to expect (report, don't panic)

These are documented M8 limits, not surprises:

- **"No form fields found"** on a page where you can see fields → the form is inside an iframe or
  shadow DOM, which the scanner doesn't traverse. Report the URL.
- A combobox reported "failed" that looks filled (or vice versa) → report which field.
- A field skipped entirely, or filled with the wrong value → report its label + what happened.

## Report back so a click becomes a regression test

For any page that misbehaves, capture the form HTML so it can join the fixture evals
(the same treatment the Greenhouse form got):

1. On the form page: `F12` → Console → run `copy(document.documentElement.outerHTML)`
2. Paste into a new file: `tests/fixtures/forms/jobsdb-apply.html` (or `ctgoodjobs-apply.html`)
3. Note the URL, what you expected, and what actually happened.

## Optional: confirm telemetry landed

After copying/filling a few fields, from the repo root:

```
npx tsx -e "const D=require('better-sqlite3');const db=new D('apps/api/data/app.sqlite');console.table(db.prepare('SELECT canonical_field,action,created_at FROM field_suggestion_events ORDER BY created_at DESC LIMIT 10').all())"
```

Rows appear for every suggestion you copied and every field the autofill filled — canonical name
and action only, never the values.
