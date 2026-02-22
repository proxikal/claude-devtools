# Design Decisions

A record of deliberate choices made during planning and implementation.
When in doubt about an approach, check here before inventing something new.

---

## No Charting Library

**Decision:** All charts and graphs in this feature use CSS-only rendering.
No Recharts, no D3, no Victory, no Visx, no Chart.js.

**Why:**
- The existing Usage Dashboard has zero charting dependencies — this was Matt's intentional choice
- Adding a library is a significant architectural decision that requires upstream approval
- The CSS bar chart pattern already in `UsageDashboard.tsx` looks professional and is
  consistent with the app's aesthetic
- A GitHub-style contribution heatmap (grid of colored divs) is pure CSS and is more
  visually impressive than a bar chart for showing long-range activity density

**What this means for implementation:**
- Activity chart: CSS bar chart, same pattern as the existing 14-day chart, variable range
- Model breakdown: `FractionBar` component, already exists, reuse it
- Heatmap (if added): CSS grid of colored squares, one per day, no library
- No line charts — these require a library to look good; skip or defer

**If you want a line chart:** Don't add a library without explicit approval from
matt1398 and proxikal. Raise it as a separate discussion. The bar chart tells
the same story and requires zero new dependencies.

---

## No New Tab Types

**Decision:** The analytics panel opens inside the existing Usage tab via local state,
not as a new tab type.

**Why:**
- Matt's tab system (`tabSlice`, `TabBar`, `SortableTab`, `tabs.ts`) is stable and
  well-tested. Touching it adds risk and scope.
- A `useState` toggle in `UsageDashboard.tsx` achieves the same UX with zero risk
- Matt can accept or reject this feature as a single contained unit

**What this means:** `selectedProjectId: string | null` in `UsageDashboard.tsx`.
Set it to open the panel. Clear it to return to overview.
Never route through the tab system for this navigation.

---

## No Real-Time Notifications in Phase 7

**Decision:** Phase 7 (Usage Insights) is historical analysis only.
Real-time session monitoring and notifications are explicitly out of scope.

**Why:**
- Real-time requires a live JSONL watcher feeding into a notification engine —
  a meaningfully different system from historical aggregation
- The historical pattern detection (Phase 7) lays the groundwork
- Real-time is a future phase, not a stretch goal of Phase 7

**What to do:** When you detect a pattern worth notifying on in real time,
document it in Phase 7's file under "Future: Real-Time Notifications."
Do not build the notification layer in this feature.

---

## Insight Signals Live in Main Process

**Decision:** All threshold logic for Usage Insights is computed in
`analyticsAggregator.ts` (main process). The renderer only renders
the pre-computed `InsightSignals` object.

**Why:**
- Keeps the renderer dumb — it displays data, it doesn't analyze it
- Aggregator is a pure function, fully testable without a browser environment
- Consistent with how the rest of the data pipeline works

**What this means:** No threshold constants or detection logic in any `.tsx` file.
If a new signal type is added, it goes in `analyticsAggregator.ts` and gets a
typed field in `InsightSignals`.

---

## Subagent Sessions Are Counted Independently

**Decision:** Subagent sessions are separate JSONL files. They are counted as
independent sessions in all totals. No parent/child token attribution.

**Why:**
- This matches the existing behavior in `computeUsageSummary()` — do not deviate
- Parent/child attribution is complex and error-prone; the data to link them
  reliably doesn't always exist
- The session list shows subagent sessions with a badge so they're identifiable,
  but they are not excluded or merged

**What this means:** When iterating project JSONL files, treat every file equally.
Detect `isSidechain: true` to set the `isSubagent` flag on the session metadata,
but still include its tokens in all totals.
