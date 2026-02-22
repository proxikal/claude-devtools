# Phase 1 — Data Pipeline

**Goal:** New IPC handler returns accurate `ProjectAnalyticsSummary` for a given projectId.
The UI does not change in this phase. This is backend-only.

---

## What to Build

1. **`analyzeSessionTimeSeriesData(filePath)`** in `src/main/utils/jsonl.ts`
   - Streaming pass (same pattern as `analyzeSessionUsageData`)
   - Returns daily/hourly buckets, session metadata, tool call counts
   - See `data-model.md` for the full return shape

2. **`src/main/utils/analyticsAggregator.ts`**
   - Pure function: takes array of session results, returns `ProjectAnalyticsSummary`
   - Computes: totals, daily array, hourly array, byModel, peakDay, peakHour, longestStreak, valueRatio, insight signals
   - No I/O. No side effects. Fully testable in isolation.

3. **`src/shared/types/projectAnalytics.ts`**
   - All new types shared between main and renderer
   - No DOM or Node APIs in this file
   - See `data-model.md` for the full type definition

4. **`src/main/ipc/projectAnalytics.ts`**
   - IPC handler, follows `usage.ts` exactly
   - 5-minute cache per projectId (Map<projectId, { data, timestamp }>)
   - Takes projectId as argument, looks up project path, runs aggregation

5. **Wire it in** — the 5-file IPC pattern:
   - `ipcChannels.ts`: add `GET_PROJECT_ANALYTICS`
   - `handlers.ts`: register the handler
   - `preload/index.ts`: expose `getProjectAnalytics(projectId)`
   - `src/shared/types/api.ts`: add to `ElectronAPI`
   - `src/renderer/api/httpClient.ts`: add standalone stub

---

## Tests Required

File: `test/main/utils/analyticsAggregator.test.ts`

Must cover:
- Empty project (no sessions)
- Single session, single model
- Multi-session with model switching mid-project
- Sessions that include subagent files (verify no double counting)
- Streak calculation: 1 day, 3 consecutive days, gap in the middle
- Peak hour and peak day detection
- Value ratio computation

Do not test the IPC handler itself — test the pure aggregator function.
The IPC wiring is covered by the existing handler pattern tests.

---

## Acceptance Criteria

- `pnpm typecheck` clean
- `pnpm test` all passing
- New aggregator tests passing
- Manual verification: call `window.electron.getProjectAnalytics(projectId)` from
  DevTools console. Compare output totals against a raw Python/manual count of the
  JSONL files for at least 2 projects. Numbers must match exactly.
- Subagent sessions counted correctly (not double-counted)
