/**
 * Analytics Aggregator
 *
 * Pure function: takes an array of per-session time-series data and a project
 * descriptor, returns a fully-computed ProjectAnalyticsSummary.
 *
 * No I/O. No side effects. Fully testable in isolation.
 */

import { estimateCostUsd, getModelLabel } from '@shared/utils/usageEstimator';

import type { SessionTimeSeriesData } from './jsonl';
import type {
  AnalyticsSession,
  ContextThrashSignal,
  DailyBucket,
  HourlyBucket,
  InsightSignals,
  PeakHourSignal,
  ProjectAnalyticsSummary,
  RetryLoopSignal,
  ShortSessionChurnSignal,
  ValueRatio,
} from '@shared/types/projectAnalytics';
import type { ModelUsage } from '@shared/types/usage';

// =============================================================================
// Public API
// =============================================================================

export interface ProjectDescriptor {
  projectId: string;
  projectName: string;
  projectPath: string;
}

export function buildProjectAnalyticsSummary(
  project: ProjectDescriptor,
  sessions: SessionTimeSeriesData[]
): ProjectAnalyticsSummary {
  if (sessions.length === 0) {
    return emptyAnalyticsSummary(project);
  }

  const validSessions = sessions.filter((s) => s.date !== '');

  // ── Totals ─────────────────────────────────────────────────────────────────
  let totalOutputTokens = 0;
  let totalAllTokens = 0;
  let totalCostUsd = 0;

  for (const s of sessions) {
    totalOutputTokens += s.outputTokens;
    totalAllTokens += s.totalTokens;
    totalCostUsd += computeSessionCost(s);
  }

  // ── Daily buckets ──────────────────────────────────────────────────────────
  const dailyMap = new Map<string, DailyBucket>();
  for (const s of validSessions) {
    const existing = dailyMap.get(s.date) ?? {
      date: s.date,
      outputTokens: 0,
      totalTokens: 0,
      sessions: 0,
      models: [],
    };
    existing.outputTokens += s.outputTokens;
    existing.totalTokens += s.totalTokens;
    existing.sessions += 1;
    if (s.model && !existing.models.includes(s.model)) {
      existing.models.push(s.model);
    }
    dailyMap.set(s.date, existing);
  }
  const daily: DailyBucket[] = Array.from(dailyMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  // ── Hourly buckets ─────────────────────────────────────────────────────────
  // Per-hour: accumulate output tokens per (hour, date), then summarize
  const hourDateMap = new Map<string, number>(); // key: "hour:date"
  const hourTotals = new Map<number, { dates: Map<string, number> }>(); // hour → {date→tokens}

  for (const s of validSessions) {
    if (s.startHour < 0) continue;
    const hour = s.startHour;
    const key = `${hour}:${s.date}`;
    const existing = hourDateMap.get(key) ?? 0;
    hourDateMap.set(key, existing + s.outputTokens);

    const entry = hourTotals.get(hour) ?? { dates: new Map<string, number>() };
    const dateTotal = entry.dates.get(s.date) ?? 0;
    entry.dates.set(s.date, dateTotal + s.outputTokens);
    hourTotals.set(hour, entry);
  }

  const hourly: HourlyBucket[] = [];
  for (const [hour, { dates }] of hourTotals.entries()) {
    const values = Array.from(dates.values());
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    let peak = 0;
    let peakDate = '';
    for (const [date, tokens] of dates.entries()) {
      if (tokens > peak) {
        peak = tokens;
        peakDate = date;
      }
    }
    hourly.push({ hour, avgOutputTokens: avg, peakOutputTokens: peak, peakDate });
  }
  hourly.sort((a, b) => a.hour - b.hour);

  // ── By model ───────────────────────────────────────────────────────────────
  const modelMap = new Map<
    string,
    { label: string; costUsd: number; sessions: number; outputTokens: number }
  >();
  for (const s of sessions) {
    for (const [modelKey, mb] of Object.entries(s.modelBreakdown)) {
      const mdl = modelMap.get(modelKey) ?? {
        label: getModelLabel(modelKey),
        costUsd: 0,
        sessions: 0,
        outputTokens: 0,
      };
      mdl.costUsd += estimateCostUsd(
        mb.inputTokens,
        mb.outputTokens,
        mb.cacheReadTokens,
        mb.cacheCreationTokens,
        modelKey
      );
      mdl.sessions += 1;
      mdl.outputTokens += mb.outputTokens;
      modelMap.set(modelKey, mdl);
    }
  }
  const maxModelOutput = Math.max(...Array.from(modelMap.values()).map((m) => m.outputTokens), 1);
  const byModel: ModelUsage[] = Array.from(modelMap.entries())
    .map(([model, m]) => ({
      model,
      label: m.label,
      costUsd: m.costUsd,
      sessions: m.sessions,
      outputTokens: m.outputTokens,
      fraction: m.outputTokens / maxModelOutput,
    }))
    .sort((a, b) => b.outputTokens - a.outputTokens);

  // ── Sessions list ──────────────────────────────────────────────────────────
  const analyticsSessions: AnalyticsSession[] = sessions
    .map((s) => ({
      sessionId: '', // filled by caller — aggregator doesn't know session IDs
      startTime: s.startTime,
      endTime: s.endTime,
      durationMs: s.durationMs,
      outputTokens: s.outputTokens,
      totalTokens: s.totalTokens,
      model: s.model,
      firstMessage: s.firstMessage,
      isSubagent: s.isSubagent,
      toolCallCount: s.toolCallCount,
      toolFailureCount: s.toolFailureCount,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  // ── Peak day / hour ────────────────────────────────────────────────────────
  let peakDay: ProjectAnalyticsSummary['peakDay'] = null;
  for (const d of daily) {
    if (!peakDay || d.outputTokens > peakDay.outputTokens) {
      peakDay = {
        date: d.date,
        outputTokens: d.outputTokens,
        totalTokens: d.totalTokens,
        sessions: d.sessions,
      };
    }
  }

  let peakHour: ProjectAnalyticsSummary['peakHour'] = null;
  for (const h of hourly) {
    if (!peakHour || h.peakOutputTokens > peakHour.outputTokens) {
      peakHour = { hour: h.hour, date: h.peakDate, outputTokens: h.peakOutputTokens };
    }
  }

  // ── Longest streak ─────────────────────────────────────────────────────────
  const longestStreak = computeLongestStreak(daily);

  // ── Date range / days active ───────────────────────────────────────────────
  const allDates = daily.map((d) => d.date);
  const dateRange =
    allDates.length > 0
      ? { first: allDates[0], last: allDates[allDates.length - 1] }
      : { first: '', last: '' };

  // ── Value ratio ────────────────────────────────────────────────────────────
  const valueRatio = computeValueRatio(sessions, totalCostUsd);

  // ── Insights ───────────────────────────────────────────────────────────────
  const insights = computeInsights(sessions, validSessions, hourly);

  return {
    projectId: project.projectId,
    projectName: project.projectName,
    projectPath: project.projectPath,
    dateRange,
    daysActive: allDates.length,
    totals: {
      outputTokens: totalOutputTokens,
      totalTokens: totalAllTokens,
      sessions: sessions.length,
      apiEquivalentCostUsd: totalCostUsd,
    },
    daily,
    hourly,
    byModel,
    sessions: analyticsSessions,
    peakDay,
    peakHour,
    longestStreak,
    valueRatio,
    insights,
  };
}

// =============================================================================
// Helpers — exported for testing
// =============================================================================

export function computeSessionCost(s: SessionTimeSeriesData): number {
  let cost = 0;
  for (const [modelKey, mb] of Object.entries(s.modelBreakdown)) {
    cost += estimateCostUsd(
      mb.inputTokens,
      mb.outputTokens,
      mb.cacheReadTokens,
      mb.cacheCreationTokens,
      modelKey
    );
  }
  return cost;
}

export function computeLongestStreak(
  daily: DailyBucket[]
): ProjectAnalyticsSummary['longestStreak'] {
  if (daily.length === 0) return null;

  let bestStart = daily[0].date;
  let bestEnd = daily[0].date;
  let bestDays = 1;
  let bestTokens = daily[0].totalTokens;

  let streakStart = daily[0].date;
  let streakDays = 1;
  let streakTokens = daily[0].totalTokens;

  for (let i = 1; i < daily.length; i++) {
    const prevDate = new Date(daily[i - 1].date);
    const currDate = new Date(daily[i].date);
    const diffDays = Math.round((currDate.getTime() - prevDate.getTime()) / 86400000);

    if (diffDays === 1) {
      streakDays++;
      streakTokens += daily[i].totalTokens;
    } else {
      streakStart = daily[i].date;
      streakDays = 1;
      streakTokens = daily[i].totalTokens;
    }

    if (streakDays > bestDays) {
      bestStart = streakStart;
      bestEnd = daily[i].date;
      bestDays = streakDays;
      bestTokens = streakTokens;
    }
  }

  return { startDate: bestStart, endDate: bestEnd, days: bestDays, totalTokens: bestTokens };
}

export function computeValueRatio(
  sessions: SessionTimeSeriesData[],
  totalCostUsd: number
): ValueRatio {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  let thisMonthCost = 0;

  for (const s of sessions) {
    if (s.date >= monthStart) {
      thisMonthCost += computeSessionCost(s);
    }
  }

  // We don't know if the user is on Max — expose both interpretations
  const MAX_SUBSCRIPTION_USD = 200;

  return {
    apiEquivalentUsd: totalCostUsd,
    thisMonthUsd: thisMonthCost,
    estimatedMaxSubscriptionUsd: MAX_SUBSCRIPTION_USD,
    ratio: totalCostUsd > 0 ? Math.round(totalCostUsd / MAX_SUBSCRIPTION_USD) : null,
  };
}

export function computeInsights(
  allSessions: SessionTimeSeriesData[],
  validSessions: SessionTimeSeriesData[],
  hourly: HourlyBucket[]
): InsightSignals {
  return {
    peakHourWarning: detectPeakHour(hourly, validSessions),
    retryLoopWarning: detectRetryLoops(allSessions),
    contextThrashWarning: detectContextThrash(allSessions),
    shortSessionChurn: detectShortSessionChurn(allSessions),
  };
}

// ── Signal detectors ──────────────────────────────────────────────────────────

function detectPeakHour(
  hourly: HourlyBucket[],
  validSessions: SessionTimeSeriesData[]
): PeakHourSignal | null {
  // Late hours: midnight to 4am (hours 0, 1, 2, 3)
  const lateHours = [0, 1, 2, 3];
  const lateBuckets = hourly.filter((h) => lateHours.includes(h.hour));
  if (lateBuckets.length === 0) return null;

  const totalOutputTokens = validSessions.reduce((sum, s) => sum + s.outputTokens, 0);
  if (totalOutputTokens === 0) return null;

  const lateOutputTokens = lateBuckets.reduce((sum, h) => sum + h.peakOutputTokens, 0);
  const tokenShare = lateOutputTokens / totalOutputTokens;

  // Count days with significant late-hour activity
  const lateDates = new Set(lateBuckets.map((h) => h.peakDate).filter(Boolean));
  const sessionCount = lateDates.size;

  if (tokenShare < 0.2 || sessionCount < 3) return null;

  return {
    detected: true,
    hours: lateBuckets.map((h) => h.hour),
    sessionCount,
    tokenShare,
  };
}

function detectRetryLoops(sessions: SessionTimeSeriesData[]): RetryLoopSignal | null {
  const FAILURE_RATE_THRESHOLD = 0.3;
  const MIN_TOOL_CALLS = 5;
  const MIN_AFFECTED_SESSIONS = 5;

  const affected = sessions.filter(
    (s) =>
      s.toolCallCount >= MIN_TOOL_CALLS &&
      s.toolFailureCount / s.toolCallCount > FAILURE_RATE_THRESHOLD
  );

  if (affected.length < MIN_AFFECTED_SESSIONS) return null;

  const avgFailureRate =
    affected.reduce((sum, s) => sum + s.toolFailureCount / s.toolCallCount, 0) / affected.length;

  return { detected: true, affectedSessions: affected.length, avgFailureRate };
}

function detectContextThrash(sessions: SessionTimeSeriesData[]): ContextThrashSignal | null {
  const RATIO_THRESHOLD = 0.05;
  const MIN_TOTAL_TOKENS = 10000;
  const MIN_AFFECTED_SESSIONS = 5;

  const affected = sessions.filter(
    (s) => s.totalTokens >= MIN_TOTAL_TOKENS && s.outputTokens / s.totalTokens < RATIO_THRESHOLD
  );

  if (affected.length < MIN_AFFECTED_SESSIONS) return null;

  const avgRatio =
    affected.reduce((sum, s) => sum + s.outputTokens / s.totalTokens, 0) / affected.length;

  return { detected: true, affectedSessions: affected.length, avgRatio };
}

function detectShortSessionChurn(
  sessions: SessionTimeSeriesData[]
): ShortSessionChurnSignal | null {
  const SHORT_DURATION_MS = 2 * 60 * 1000; // 2 minutes
  const SHORT_TOKEN_THRESHOLD = 10000;
  const CHURN_PERCENTAGE_THRESHOLD = 0.2;
  const MIN_TOTAL_SESSIONS = 5;

  if (sessions.length < MIN_TOTAL_SESSIONS) return null;

  const shortSessions = sessions.filter(
    (s) => s.durationMs < SHORT_DURATION_MS && s.totalTokens < SHORT_TOKEN_THRESHOLD
  );

  const percentage = shortSessions.length / sessions.length;
  if (percentage < CHURN_PERCENTAGE_THRESHOLD) return null;

  return { detected: true, count: shortSessions.length, percentage };
}

// =============================================================================
// Empty summary
// =============================================================================

function emptyAnalyticsSummary(project: ProjectDescriptor): ProjectAnalyticsSummary {
  return {
    projectId: project.projectId,
    projectName: project.projectName,
    projectPath: project.projectPath,
    dateRange: { first: '', last: '' },
    daysActive: 0,
    totals: { outputTokens: 0, totalTokens: 0, sessions: 0, apiEquivalentCostUsd: 0 },
    daily: [],
    hourly: [],
    byModel: [],
    sessions: [],
    peakDay: null,
    peakHour: null,
    longestStreak: null,
    valueRatio: {
      apiEquivalentUsd: 0,
      thisMonthUsd: 0,
      estimatedMaxSubscriptionUsd: 200,
      ratio: null,
    },
    insights: {
      peakHourWarning: null,
      retryLoopWarning: null,
      contextThrashWarning: null,
      shortSessionChurn: null,
    },
  };
}
