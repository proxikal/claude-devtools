# Project Analytics — Feature Plan

**Owner:** proxikal (fork: https://github.com/proxikal/claude-devtools)
**Branch:** `feat/project-analytics` (branch off `feat/spend-dashboard` once that merges)
**Upstream:** matt1398/claude-devtools — **never open a PR without explicit user approval**
**Status:** PLANNING — not started
**Last Updated:** 2026-02-22

---

## Vision

When a user clicks a project row in the Usage Dashboard, a full analytics panel opens
inside the same tab. No new tab type. No new icon. No changes to Matt's tab system.

The panel shows everything meaningful about that project's Claude usage history:
time-series token activity, model breakdown, session-level detail, and for API users,
real cost data. For Max subscription users, it shows API-equivalent value — how much
compute they extracted vs what they paid. The "value ratio" (e.g. "$8,900 of compute
for $200 in 2 months") is the headline moment that makes this screenshot-worthy.

This is built for power users first. Someone who has run billions of tokens across
hundreds of sessions on a serious project (compiler, framework, etc.) should be able
to understand their usage history at a glance, see their working patterns, and have
data that makes them proud of how much they've built.

---

## What Exists Today (Usage Dashboard)

The `feat/spend-dashboard` branch (renamed to usage-focused) already has:

- **Overview stats:** Today / Week / Month / All Time output token counts
- **14-day bar chart:** CSS-only, output tokens per day
- **By Project:** ranked by total context tokens, two bars (output + total), show-more
- **By Model:** per-model output tokens, accurate multi-model session attribution
- **Top Sessions:** ranked by total tokens, show-more

Key infrastructure already in place:
- `src/main/ipc/usage.ts` — IPC handler, 2-min cache, `computeUsageSummary()`
- `src/main/utils/jsonl.ts` — `analyzeSessionUsageData()`, per-model breakdown
- `src/shared/types/usage.ts` — `UsageSummary`, `ProjectUsage`, `ModelUsage`, `SessionUsage`
- `src/renderer/components/usage/UsageDashboard.tsx` — full dashboard component
- `src/shared/utils/usageEstimator.ts` — cost estimation, model label mapping

The overview is intentionally lightweight — it aggregates everything into totals.
The analytics panel will be the deep-dive layer, loaded on demand.

---

## Architecture Decision

**Where it lives:** Inside the Usage tab. Clicking a project row transitions the dashboard
to a project detail view. A back button returns to the overview. This is a UI state
change only — `useState` in `UsageDashboard.tsx` tracks `selectedProject | null`.

**Why this approach:**
- Zero changes to Matt's tab system (`tabSlice`, `tabs.ts`, `TabBar`, `SortableTab`)
- Zero new IPC channel patterns — follows existing handler structure
- Fully contained in `feat/project-analytics` branch
- Matt can accept or reject it as a single unit
- Consistent with how the app already works (tabs are persistent views)

**New files this feature creates:**
```
src/renderer/components/usage/ProjectAnalyticsPanel.tsx  — main panel component
src/main/ipc/projectAnalytics.ts                         — IPC handler
src/shared/types/projectAnalytics.ts                     — types for the richer data
src/main/utils/analyticsAggregator.ts                    — time-series aggregation logic
```

**Files it modifies (minimally):**
```
src/renderer/components/usage/UsageDashboard.tsx         — add click handler + panel routing
src/main/ipc/handlers.ts                                 — register new handlers
src/preload/index.ts                                      — expose new IPC method
src/shared/types/api.ts                                  — add to ElectronAPI
src/renderer/api/httpClient.ts                           — standalone mode support
src/preload/constants/ipcChannels.ts                     — new channel constant
```

---

## Data Model

The existing `analyzeSessionUsageData` does one streaming pass per JSONL file and
returns aggregate totals. For analytics we need time-series data — tokens bucketed
by day and hour across all sessions in a project.

**New function needed:** `analyzeSessionTimeSeriesData(filePath)` in `jsonl.ts`

Returns per-session:
- Hourly token buckets (for the heat map and peak-hour detection)
- Daily token buckets (for the activity chart)
- Model used per time window (for model timeline)
- Session start/end timestamps
- Whether it was a subagent session (check `isSidechain` field)

**New IPC response type:** `ProjectAnalyticsSummary`
```
- projectId, projectName, projectPath
- dateRange: { first, last }
- totals: { outputTokens, totalTokens, sessions, apiEquivalentCostUsd }
- daily: Array<{ date, outputTokens, totalTokens, sessions, models: string[] }>
- hourly: Array<{ hour (0-23), avgTokens, peakDate }>  — aggregated across all days
- byModel: same as UsageSummary.byModel but scoped to this project
- sessions: full session list with timestamps, tokens, model, firstMessage, isSubagent
- peakDay: { date, outputTokens, sessions }
- peakHour: { hour, date, outputTokens }
- valueRatio: { apiEquivalentUsd, estimatedMonthlySubscriptionUsd, ratio }
  — only meaningful if subscription pricing known; show "N/A" for API users
```

**Important:** Subagent sessions are separate JSONL files in the same project folder.
They must NOT be double-counted. Each JSONL file is an independent session.
The existing `computeUsageSummary` already handles this correctly — follow the same
pattern. Do not attempt to link parent/child sessions for token attribution.

**Caching:** Use the same module-level cache pattern as `usage.ts`. TTL: 5 minutes.
Cache per projectId. Invalidate on app restart (already handled by `cachedSummary = null`
in `registerHandlers`).

---

## Panel Layout (What the User Sees)

```
← Back to Overview                    Atlas
                                       /Users/proxikal/dev/projects/atlas

┌──────────────────────────────────────────────────────────┐
│  5.63B total context  ·  5.2M output  ·  225 sessions    │
│  Feb 1 – Feb 22, 2026  ·  22 days active                 │
└──────────────────────────────────────────────────────────┘

ACTIVITY  [30 days]  [90 days]  [All time]
  ← bar chart, one bar per day, colored by token density →
  X-axis: dates   Y-axis: total tokens   Highlight: peak day

PEAK MOMENTS
  Busiest day:   Feb 18 · 847M tokens · 12 sessions
  Busiest hour:  Feb 18 at 2am · 312M tokens
  Longest run:   Feb 15–18 · 4-day streak · 2.1B tokens

BY MODEL (this project only)
  Sonnet 4.5    ████████████████  4.1B total  73%  ·  182 sessions
  Opus 4.5      ██████░░░░░░░░░░  1.2B total  21%  ·  63 sessions
  Sonnet 4.6    ██░░░░░░░░░░░░░░  340M total   6%  ·  18 sessions

API EQUIVALENT VALUE                     ← show for all users
  All time:      $8,947 at public API prices
  This month:    $3,420
  ↳ If on Max:   You paid ~$200 · Value ratio: 44x
  ↳ If on API:   This is your actual spend

SESSIONS  (sorted by: Total tokens ▾)  [show 10 / show all]
  Each row: timestamp · model · output tokens · total tokens · first message preview
  Subagent sessions get a subtle badge so they're identifiable
```

---

## Phase Plan

Work in this order. Each phase must pass all quality gates before the next begins.
Do not skip ahead. Do not stub implementations.

### Phase 1 — Data Pipeline
**Goal:** New IPC handler returns accurate `ProjectAnalyticsSummary` for a given projectId.

1. Add `analyzeSessionTimeSeriesData()` to `jsonl.ts` — streaming pass, returns daily/hourly buckets and session metadata
2. Add `src/main/utils/analyticsAggregator.ts` — takes array of session results, builds `ProjectAnalyticsSummary`
3. Add `src/shared/types/projectAnalytics.ts` — all new types
4. Add `src/main/ipc/projectAnalytics.ts` — handler, 5-min cache per projectId
5. Wire into `handlers.ts`, `preload/index.ts`, `api.ts`, `httpClient.ts`, `ipcChannels.ts`

**Acceptance criteria:**
- `pnpm typecheck` clean
- `pnpm test` all passing (add tests for `analyticsAggregator.ts` — at minimum: empty project, single session, multi-session with model switching, subagent sessions)
- Verified manually: call IPC from renderer console, check numbers match raw JSONL Python verification

### Phase 2 — Panel Shell
**Goal:** Clicking a project row opens the panel. Back button returns to overview. No data yet — loading state only.

1. Add `ProjectAnalyticsPanel.tsx` — shell with header, back button, loading/error states
2. Add `selectedProjectId: string | null` state to `UsageDashboard.tsx`
3. Project rows become `<button>` elements — cursor pointer, hover highlight
4. Wire up: click → set selectedProjectId, render panel; back → clear it

**Acceptance criteria:**
- Click any project → panel opens, shows loading spinner
- Back button → returns to overview, scroll position preserved
- No visual regressions on the overview

### Phase 3 — Summary Header + Activity Chart
**Goal:** Top stats and the main activity chart are live.

1. Render the summary header (totals, date range, days active)
2. Build the activity bar chart — same CSS-only approach as the 14-day chart, but variable range (30/90/all-time toggle)
3. Peak moments section (busiest day, busiest hour, longest streak)

**Acceptance criteria:**
- Numbers verified against raw JSONL Python check for at least 2 projects
- Chart renders correctly with 0-day gaps (missing days = empty bar, not skipped)
- Toggle between time ranges works without refetching (data already in summary)

### Phase 4 — Model Breakdown + Value Section
**Goal:** Per-model stats scoped to this project, plus the API equivalent value display.

1. Render `byModel` section — reuse `FractionBar`, same pattern as overview but scoped
2. Value section:
   - Always show "API equivalent: $X all time / $Y this month"
   - For Max users (detect via subscription hint if available, otherwise show both interpretations): show value ratio
   - For API users: "This is your actual spend at public prices"
   - Note: pricing uses `usageEstimator.ts` which is already accurate per-model

**Acceptance criteria:**
- Value numbers match `estimateCostUsd()` output verified manually
- Value ratio only shown when meaningful (not shown when costUsd is 0 or unknown)

### Phase 5 — Sessions List
**Goal:** Full session list with subagent badges, sortable, paginated.

1. Render session rows — timestamp, model badge, output tokens, total tokens, first message
2. Subagent sessions get a subtle "subagent" badge (check the session's JSONL for `isSidechain: true` on the first entry, or detect via existing `SubagentResolver` patterns if accessible)
3. Sort options: Total tokens (default), Date (newest), Output tokens
4. Default show 10, "Show all" expands

**Acceptance criteria:**
- Session list matches what the main sidebar would show for that project
- Subagent detection is accurate (verify against a project known to have subagents)
- Sort works client-side (data already loaded)

### Phase 6 — Polish + Quality Pass
**Goal:** It looks awe-inspiring, passes all checks, ready for review.

1. Visual polish — consistent with the rest of the app's design system (CSS variables, no hardcoded colors, dark/light theme works)
2. Empty states — new project with 1 session, project with only subagent sessions
3. Performance — panel should feel instant for small projects, graceful for large ones (Atlas 225 sessions should load in < 2s)
4. Run full quality suite: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
5. Verify Windows CI passes (no `toLocaleString`, no Intl without guards)
6. Manual test on macOS + Windows

---

## Quality Gates (Must Pass Before Each Commit)

```bash
pnpm typecheck   # zero errors
pnpm lint        # zero errors (warnings ok if pre-existing)
pnpm test        # all 654+ tests passing
pnpm build       # clean build
```

Additional for Phase 1:
```bash
vitest run test/main/utils/analyticsAggregator.test.ts
```

**Never skip quality gates. Never commit with type errors.**

---

## Code Standards

Follow existing patterns in this codebase exactly:

- **Imports:** path aliases (`@main/*`, `@renderer/*`, `@shared/*`) — no relative imports across process boundaries
- **IPC pattern:** handler in `src/main/ipc/`, channel constant in `ipcChannels.ts`, exposed in `preload/index.ts`, typed in `src/shared/types/api.ts`, implemented in `httpClient.ts` for standalone mode
- **Types:** shared types in `src/shared/types/` — no DOM or Node APIs
- **Components:** one component per file, PascalCase, functional with hooks, CSS variables for all colors
- **No new dependencies** without strong justification — we have zero charting libraries and that's intentional
- **Conventional commits:** `feat:`, `fix:`, `refactor:` — include rationale in body

---

## Branch & PR Strategy

```
main (local + fork)
  └── feat/spend-dashboard        ← usage dashboard (current work)
        └── feat/project-analytics ← this feature (branch off after spend-dashboard merges)
```

- Keep `feat/spend-dashboard` and `feat/project-analytics` as separate branches
- Push both to fork (`proxikal/claude-devtools`) after each work session
- **Never open a PR to matt1398/claude-devtools without explicit user instruction**
- Never force push to main
- Never use `--publish` flag with electron-builder (releases only via `--publish never`)

When `feat/spend-dashboard` merges to local main, rebase `feat/project-analytics` on top of it before continuing work.

---

## Picking Up Mid-Session (Agent Instructions)

If you are resuming work on this feature:

1. Read this file first
2. Check current branch: `git branch --show-current`
3. Check what's been built: `git log --oneline -10`
4. Run `pnpm typecheck && pnpm test` to confirm clean state
5. Find the current phase by reading which files exist:
   - `src/shared/types/projectAnalytics.ts` exists? Phase 1 started
   - `src/main/ipc/projectAnalytics.ts` exists? Phase 1 in progress or done
   - `src/renderer/components/usage/ProjectAnalyticsPanel.tsx` exists? Phase 2+ in progress
6. Update this file's **Status** line at the top when phases complete

**Do not start a new phase until the previous one passes all quality gates.**
**Do not stub implementations — if a function isn't ready, don't call it.**
**Do not open PRs. Do not build releases. Do not push to fork without user confirmation.**

---

## Why This Matters

The existing session viewer shows you *what* Claude did in a session.
This shows you *how* you work — your patterns, your intensity, your investment.

For someone who has run 5+ billion tokens across a serious project in 2 months,
this isn't analytics. It's a mirror.
