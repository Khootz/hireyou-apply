# PROGRESS — loop state

Read PLAN.md first. One milestone per loop. Update this file every loop.

| Milestone | Status | Loops used | Verifier |
|---|---|---|---|
| M0 Scaffold + harness | **DONE** (machine checks green; manual: load extension in Chrome pending user) | 3 | `npm run verify:m0` |
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

**2026-08-10 — M0, loops 1–3 → GREEN (verify:m0 exit 0; 15 passed, 1 skipped)**
- Loop 1: full scaffold (43 files). FAIL: happy-dom fetched fixture stylesheets → unhandled rejections.
- Loop 2: disabled resource loading, then sanitized `<link>/<script>`. Tests passed but happy-dom still errored; upgrade to happy-dom 20 then **truncated the board's legacy nested-table HTML (6/57 anchors parsed)** → swapped harness to **jsdom** (parse5 = Chrome's HTML algorithm). Clean.
- Loop 3: live DeepSeek smoke initially failed — discovered machine-wide `HTTP(S)_PROXY=127.0.0.1:10808`; Node fetch ignores it. Fixed LLM client with undici `ProxyAgent`. Live roundtrip green. Dep bumps (drizzle 0.44, vite 8, vitest 4) → 0 audit vulnerabilities.
- Learned (matters for later milestones): all outbound HTTP must be proxy-aware (M2 parse, M4 generation fine — they go through the LLM client; M7 SMTP needs SOCKS tunnel); jsdom is the fixture parser of record, do not use happy-dom on HKUST HTML.
- Manual checklist remaining for user: `chrome://extensions` → Load unpacked → `apps/extension` → icon click opens the M0 side panel.
- Blocker for M7 (not M1–M6): Gmail app password for 199ktz@gmail.com (regular password rejected, verified).

(append entries here: date, milestone, attempt #, changes, verifier output, next action)
