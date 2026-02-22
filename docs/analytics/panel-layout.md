# Panel Layout

## What the User Sees

```
← Back to Overview                    Atlas
                                       /Users/proxikal/dev/projects/atlas

┌──────────────────────────────────────────────────────────┐
│  5.63B total context  ·  5.2M output  ·  225 sessions    │
│  Feb 1 – Feb 22, 2026  ·  22 days active                 │
└──────────────────────────────────────────────────────────┘

ACTIVITY  [30 days ▾]
  ← bar chart, one bar per day, colored by token density →
  X-axis: dates   Y-axis: total tokens   Highlight: peak day

PEAK MOMENTS
  Busiest day:    Feb 18 · 847M tokens · 12 sessions
  Busiest hour:   Feb 18 at 2am · 312M tokens
  Longest streak: Feb 15–18 · 4 days · 2.1B tokens

BY MODEL  (this project)
  Sonnet 4.5    ████████████████  4.1B total  73%  ·  182 sessions
  Opus 4.5      ██████░░░░░░░░░░  1.2B total  21%  ·   63 sessions
  Sonnet 4.6    ██░░░░░░░░░░░░░░  340M total   6%  ·   18 sessions

API EQUIVALENT VALUE
  All time:       $8,947 at public API prices
  This month:     $3,420
  ↳ If on Max:    You paid ~$200/mo · Value ratio: 44x
  ↳ If on API:    This is your actual spend

USAGE INSIGHTS  [toggle: on/off]           ← Phase 7, off by default
  ⚠  Peak hours at 2–4am on 8 of 22 days  →  see details
  ⚠  High retry rate in 14 sessions       →  see details
  ✓  Model choices look efficient

SESSIONS  (sort: Total tokens ▾)  [showing 10 of 225]  [Show all]
  Feb 22  2:14am  Sonnet 4.5    14.2M total   820K output   "Implement the type unifier..."
  Feb 21  11:50pm Opus 4.5      8.9M total    560K output   "Debug the constraint solver..."
  Feb 21  4:30pm  Sonnet 4.5    6.1M total    210K output   "subagent" [badge]
  ...
  [Show all 225 sessions]
```

---

## Design Rules

- Uses existing CSS variables — no hardcoded colors, no new color tokens unless truly necessary
- Bar chart is CSS-only, same approach as the 14-day chart on the overview
- The "Value ratio" line is the headline. It should be visually prominent, not buried
- Insights section is collapsed by default — it's opt-in, not pushed on the user
- Subagent sessions get a subtle badge, not a different row style
- The back button is always visible — no scroll-to-top required to exit

---

## Responsive Behavior

- The panel fills the same content area as the overview dashboard
- At narrower widths, the model breakdown bars compress (same as overview behavior)
- No horizontal scrolling — everything stacks gracefully

---

## Empty States

Every section must have a defined empty state:

- No sessions yet: "No sessions recorded for this project"
- Single session: Peak Moments shows just the one day, no streak
- Only subagent sessions: All stats accurate, subagent badge on every row
- Project with 0 tokens: Shouldn't happen, but shows zeros gracefully — no divide-by-zero

---

## Interaction Notes

- Time range toggle (30 days / 90 days / All time) is a local state change — no refetch
  The full dataset is already in `ProjectAnalyticsSummary`. Filter client-side.
- Sort change in sessions list is also client-side — no refetch
- Insights "see details" expands inline — no modal, no new panel
- "Show all" in sessions simply renders the full list — no pagination, no virtualization
  (225 rows is not a performance concern; virtual scroll is not needed here)
