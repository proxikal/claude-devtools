# Data Model

## What Exists vs. What's New

The existing `analyzeSessionUsageData()` in `jsonl.ts` does one streaming pass per
JSONL file and returns aggregate totals. That's sufficient for the overview dashboard.

For analytics, we need more: tokens bucketed by day and by hour, session-level metadata,
and enough to support the Insights system (peak hours, retry loops, context thrash).

---

## New Function: `analyzeSessionTimeSeriesData(filePath)`

Lives in `src/main/utils/jsonl.ts` alongside the existing function.

Single streaming pass. Returns per-session:

- Daily token buckets: `{ date: string, outputTokens: number, totalTokens: number }`
- Hourly token buckets: `{ hour: number (0–23), outputTokens: number, totalTokens: number }`
- Models encountered with timestamps (for model-switching detection)
- Session start timestamp, end timestamp, duration
- First user message text (truncated to ~120 chars for session list preview)
- Whether it's a subagent session (`isSidechain: true` on the first entry)
- Tool call count and failure count (for retry loop detection in Insights)
- Number of distinct context switches (for context thrash detection)

---

## New Type: `ProjectAnalyticsSummary`

Lives in `src/shared/types/projectAnalytics.ts`. Shared between main and renderer.
No DOM or Node APIs in this file.

```
projectId: string
projectName: string
projectPath: string
dateRange: { first: string, last: string }
daysActive: number

totals:
  outputTokens: number
  totalTokens: number
  sessions: number
  apiEquivalentCostUsd: number

daily: Array<{
  date: string               (ISO date, "2026-02-18")
  outputTokens: number
  totalTokens: number
  sessions: number
  models: string[]
}>

hourly: Array<{
  hour: number               (0–23)
  avgOutputTokens: number    (average across all days this hour had activity)
  peakOutputTokens: number
  peakDate: string
}>

byModel: ModelUsage[]        (same shape as UsageSummary.byModel, project-scoped)

sessions: Array<{
  sessionId: string
  startTime: string
  endTime: string
  durationMs: number
  outputTokens: number
  totalTokens: number
  model: string
  firstMessage: string       (truncated preview)
  isSubagent: boolean
  toolCallCount: number
  toolFailureCount: number
}>

peakDay: { date: string, outputTokens: number, totalTokens: number, sessions: number }
peakHour: { hour: number, date: string, outputTokens: number }
longestStreak: { startDate: string, endDate: string, days: number, totalTokens: number }

valueRatio: {
  apiEquivalentUsd: number
  thisMonthUsd: number
  estimatedMaxSubscriptionUsd: number | null
  ratio: number | null
}

insights: InsightSignals    (see phase-7-insights.md — computed here, not in renderer)
```

---

## Subagent Handling

Subagent sessions are separate JSONL files in the same project folder. They must NOT
be double-counted in totals. Each JSONL file is an independent session.

Detection: check for `isSidechain: true` in the first entry of the JSONL, or look for
the `subagent` role indicator in the session metadata. The existing `computeUsageSummary`
already handles this correctly — follow the exact same pattern.

Do not attempt to link parent and child sessions for token attribution. They are
counted independently, same as they are in the overview dashboard.

---

## Caching Strategy

Same module-level cache pattern as `usage.ts`:
- Cache per `projectId`
- TTL: 5 minutes
- Invalidated on app restart (module reloads)
- No persistence to disk

For a project with 225 sessions (Atlas-scale), the aggregation should complete in under
500ms on first load. Subsequent loads hit the cache and are instant.

---

## Cost Estimation

Use the existing `estimateCostUsd()` from `usageEstimator.ts`. Do not create new
pricing logic. The value ratio computation lives in `analyticsAggregator.ts` and
calls this function with the per-model token counts already scoped to the project.
