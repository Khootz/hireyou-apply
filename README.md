# HireYou Apply

Job application copilot for students: AI-tailored resume + cover letter generation and
application assistance on real job boards (HKUST career board first). Standalone feature
module intended for future integration into HireYou 2.0.

- **PLAN.md** — build plan, milestones, exit criteria. Read first.
- **PROGRESS.md** — loop state. Read second, update every loop.

## Layout

- `apps/api` — Fastify API (auth, DB, DeepSeek client, later: generation/PDF/email)
- `apps/web` — Vite + React web app (My Resume editor, job tracker)
- `apps/extension` — Chrome MV3 extension (side panel, content scripts)
- `packages/shared` — zod schemas + DOM extractors shared by all of the above
- `tests/fixtures` — real captured HTML, CVs, recorded LLM responses

## Commands

```bash
npm install            # once
npm run dev            # API on :3100 + web on :5180, together
npm test               # all tests (LLM calls replay from fixtures; no network)
npm run verify:m8      # current milestone verifier (typecheck + ext build + tests)
npm run build:extension
```

Copy `.env.example` to `.env` and fill it in. `LIVE_LLM=1 npm test` additionally runs
the live DeepSeek smoke tests (costs a fraction of a cent).

**Extension:** `npm run build:extension`, then `chrome://extensions` → Developer mode →
Load unpacked → `apps/extension/dist`. Open the panel via the toolbar icon, set the
API token in ⚙ settings (must match `API_AUTH_TOKEN` in `.env`).

**Refresh LLM fixtures** (after changing prompts/profile):
`npx tsx scripts/record-cv-parse.ts`, `scripts/record-generation.ts`, `scripts/record-autofill.ts`.

**What works end to end:** profile editor with CV-PDF pre-fill → save HKUST postings
from the extension → tailored resume + cover letter (provenance-gated) → PDF preview/
download → application email with attachments (SAFE_MODE delivers to the test inbox) →
one-click autofill on any http(s) application page (fill → verify → retry loop with
per-field ✓/⚠ report, combobox type-ahead driving, staggered visible fill; EEO fields
always blocked, never auto-submits). Classifications are cached per form shape in
SQLite, so repeat scans are instant and survive LLM outages. Primary demo target:
OKX Hong Kong postings on Greenhouse (e.g.
`boards.greenhouse.io/embed/job_app?for=okx&token=7731745003`) — the evals in
`apps/api/tests/autofill-greenhouse.test.ts` run the full pipeline against real
captured OKX + Anthropic form HTML and require a 100% verified fill rate.
See PROGRESS.md for per-milestone status.
