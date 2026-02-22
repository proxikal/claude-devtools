# Phase 7 — Usage Insights

**Goal:** A toggleable panel section that reflects the user's own usage patterns back
at them — not AI advice, not guesswork. Just their data, interpreted clearly enough to act on.

---

## Vision

Some users have genuinely expensive habits they're not aware of:
- Running heavy sessions at late hours when they're tired and less precise
- Retry loops: tool calls failing and being retried 5+ times on the same problem
- Context thrash: switching topics mid-session constantly, which inflates context tokens
- Starting over instead of refining: many very short sessions on the same project

This system detects these patterns from existing JSONL data. It doesn't require any AI
inference, external data, or user input. It's threshold logic applied to numbers that
already exist in `ProjectAnalyticsSummary`.

The insights section is **off by default**. The user enables it with a toggle.
When enabled, it shows a short list of detected patterns — each one actionable,
none of them shaming.

---

## What Gets Detected

### Peak Hour Pattern
If the user has significant activity (>20% of total tokens) between midnight and 4am,
across 3+ days, surface it:
> "Most of your heaviest sessions run between 2am and 4am. Late-night sessions
> tend to be less efficient — more retries, more context thrash."

Detection lives in `analyticsAggregator.ts`. Input: `hourly` bucket array.
Threshold: hourly token share > 20% and occurring on 3+ distinct dates.

### Retry Loop Detection
If a session has a tool failure rate above 30% (toolFailureCount / toolCallCount > 0.3)
and more than 5 total tool calls, flag it. If this pattern appears in 5+ sessions:
> "14 sessions had high tool failure rates (>30%). This usually means a command or path
> is wrong and being retried. Catching it earlier saves significant tokens."

Detection: `sessions` array, `toolFailureCount / toolCallCount` ratio.

### Context Thrash
Sessions with high total token counts but low output token ratios
(outputTokens / totalTokens < 0.05) suggest context-heavy work with little output —
possible indicators of mid-session topic switching or loading large files unnecessarily.
If this appears in 5+ sessions:
> "Several sessions had very low output-to-context ratios. Large context, small output
> can indicate loading files that weren't needed or frequent topic changes."

Detection: per-session output/total ratio.

### Short-Session Churn
If a project has more than 20% of its sessions under 2 minutes with fewer than
10K total tokens — possible "started over" sessions:
> "X sessions on this project were under 2 minutes. Frequent restarts can mean
> small prompt improvements could have continued the existing session instead."

Detection: `sessions` array, `durationMs < 120000 && totalTokens < 10000`.

---

## Data Flow

Insight signals are computed in `analyticsAggregator.ts` alongside the rest of the summary.
They are included in `ProjectAnalyticsSummary.insights` as a typed `InsightSignals` object.

The renderer reads the signals and renders them — it does not compute thresholds itself.
All detection logic lives in the main process, not in the component.

```
InsightSignals:
  peakHourWarning: { detected: boolean, hours: number[], sessionCount: number, tokenShare: number } | null
  retryLoopWarning: { detected: boolean, affectedSessions: number, avgFailureRate: number } | null
  contextThrashWarning: { detected: boolean, affectedSessions: number, avgRatio: number } | null
  shortSessionChurn: { detected: boolean, count: number, percentage: number } | null
```

Each signal is `null` if the pattern wasn't detected (i.e., nothing to show).

---

## Rendering

In `ProjectAnalyticsPanel.tsx`, the Insights section sits between the Value section
and the Sessions list. It is gated behind a toggle stored in component state (not
persisted to settings — at least not in this phase).

When enabled:
- Each non-null signal renders as a row with an icon (warning or checkmark)
- If no signals are detected, show: "No unusual patterns detected for this project."
- "See details" expands an inline explanation (no modal)

When disabled:
- The section is completely hidden (not just collapsed)

---

## Future: Real-Time Notifications

This phase is historical analysis only. A future phase could watch the active session's
JSONL in real time and fire a notification like "You've been in a retry loop for 10 minutes."

That is explicitly out of scope for Phase 7. Log it as a future idea, don't build it.
The groundwork (detecting the patterns) is laid here. The notification layer comes later.

---

## Acceptance Criteria

- Toggle shows/hides the insights section cleanly
- Each signal type renders correctly with real data from a known project
- No signals shown for a "clean" project (one with no detected patterns)
- All detection logic is in `analyticsAggregator.ts` — zero threshold logic in the renderer
- New signal types are easy to add — the pattern is extensible by design
- `InsightSignals` type is exported from `projectAnalytics.ts` and used consistently
- `pnpm typecheck` clean, `pnpm test` all passing
- Aggregator tests include at least one test for each signal type (detected + not detected)
