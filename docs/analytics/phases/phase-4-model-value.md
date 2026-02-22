# Phase 4 — Model Breakdown + Value Section

**Goal:** Per-model stats scoped to this project, plus the API equivalent value display.

---

## What to Build

1. **By Model section**
   - Reuse the `FractionBar` component (or equivalent) from the overview dashboard
   - Same visual pattern: model name, filled bar, total tokens, percentage, session count
   - Scoped to this project only — not global totals
   - Sort by total tokens descending

2. **API Equivalent Value section**
   - This is the headline moment. Give it visual weight.
   - Always show:
     - "API equivalent: $X,XXX all time"
     - "This month: $X,XXX"
   - Then, context-dependent:
     - If on Max subscription (or unknown — show both interpretations):
       "If on Max (~$200/mo): value ratio Nx"
     - If clearly on API: "This is your actual spend at public API prices"
   - The value ratio is computed in `analyticsAggregator.ts` — do not recompute in the renderer
   - Use `estimateCostUsd()` from `usageEstimator.ts` — do not create new pricing logic

---

## Notes on Value Display

The value ratio is the "holy shit" moment for Max users. Make it feel like a reveal,
not a footnote. It should be the most visually prominent number on the panel after
the total token count.

Do not show value ratio if:
- `apiEquivalentUsd` is 0 or unknown
- `ratio` is null (couldn't compute)
- The ratio is less than 1 (would look broken, not impressive)

For number formatting: always pass `'en-US'` to `toLocaleString`. Windows CI will fail
without it. This applies everywhere in this feature.

---

## Acceptance Criteria

- Model percentages sum to 100% (or very close — float rounding is acceptable)
- Value numbers match `estimateCostUsd()` output verified manually
- Value ratio section renders correctly for both Max and API interpretations
- Value ratio hidden when `ratio` is null or 0
- `pnpm typecheck` clean, `pnpm test` all passing
