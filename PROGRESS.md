# PROGRESS — loop state

Read PLAN.md first. One milestone per loop. Update this file every loop.

| Milestone | Status | Loops used | Verifier |
|---|---|---|---|
| M0 Scaffold + harness | not started | 0 | `npm run verify:m0` |
| M1 Master profile | not started | 0 | `npm run verify:m1` |
| M2 CV PDF pre-fill | not started | 0 | `npm run verify:m2` |
| M3 Job tracker | not started | 0 | `npm run verify:m3` |
| M4 Generation engine | not started | 0 | `npm run verify:m4` |
| M5 PDF rendering | not started | 0 | `npm run verify:m5` |
| M6 Extension + HKUST | not started | 0 | `npm run verify:m6` |
| M7 Email apply | not started | 0 | `npm run verify:m7` |
| M8 Form hints (best-effort) | not started | 0 | `npm run verify:m8` |
| M9 Hardening | not started | 0 | — |

## Pre-build log

**2026-08-10 — planning session**
- Idea brief confirmed with user (see PLAN.md §1 and Claude memory `amploy-rebuild-brief`).
- HKUST fixtures captured while session cookie was live: `tests/fixtures/hkust/` — list-page-1.html (20 rows), detail-86585/86643/86638.html. detail-86585 = Quant Researcher Intern @ Jain Global, apply email present.
- DeepSeek key verified against `/models`: `deepseek-v4-flash`, `deepseek-v4-pro` available.
- `.env` created (gitignored), `.env.example` committed pattern.

## Loop log

(append entries here: date, milestone, attempt #, changes, verifier output, next action)
