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
npm install          # once
npm test             # all tests (LLM calls replay from fixtures; no network)
npm run typecheck
npm run verify:m0    # milestone verifier
npm run dev:api      # API on :3100
npm run dev:web      # web on :5180 (proxies /api -> :3100)
```

Copy `.env.example` to `.env` and fill it in. `LIVE_LLM=1 npm test` additionally runs
the live DeepSeek smoke tests (costs a fraction of a cent).

Load the extension: `chrome://extensions` → Developer mode → Load unpacked → `apps/extension`.
