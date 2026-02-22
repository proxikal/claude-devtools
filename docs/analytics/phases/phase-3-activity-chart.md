# Phase 3 — Summary Header + Activity Chart

**Goal:** Top stats and the main activity chart are live. Peak moments section visible.

---

## What to Build

1. **Summary header**
   - Total context tokens, output tokens, session count (formatted with appropriate unit: M, B)
   - Date range (first session → last session, human-readable)
   - Days active count

2. **Activity bar chart**
   - CSS-only, same implementation pattern as the 14-day chart on the overview
   - One bar per day, height proportional to total tokens that day
   - X-axis: date labels (every N days depending on range)
   - Y-axis: implicit (bars are relative to the tallest bar in the visible range)
   - Peak day bar gets a highlight color or marker
   - Zero-days (no activity) render as an empty bar slot — not skipped, not hidden
   - Time range toggle: 30 days / 90 days / All time
     - Toggle is a local `useState` filter on the `daily` array — no refetch

3. **Peak Moments section**
   - Busiest day: date + total tokens + session count
   - Busiest hour: date + hour (12-hour format with am/pm) + output tokens
   - Longest streak: start date, end date, day count, total tokens

---

## Notes on the Chart

The overview's 14-day chart is the reference. Study it before building this.
The only differences:
- Variable range (not fixed 14 days)
- The "fill to today" logic from the overview applies here too — if the range
  extends to today, include today even if it has zero activity
- Highlight the peak day bar distinctly

Do not introduce a charting library. This is a CSS bar chart. It works beautifully
already — extend the pattern, don't replace it.

---

## Acceptance Criteria

- Numbers match raw JSONL manual verification for at least 2 projects
- Chart renders correctly with 0-day gaps (empty slot, not skipped)
- Toggle between 30 / 90 / All time works without any IPC call
- Peak day bar is visually distinct
- Longest streak calculation is correct (verified manually)
- `pnpm typecheck` clean, `pnpm test` all passing
