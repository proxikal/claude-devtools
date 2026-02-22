/**
 * Project Analytics types shared between main and renderer.
 * No DOM or Node APIs — pure data shapes.
 */

import type { ModelUsage } from './usage';

// =============================================================================
// Time-Series Buckets
// =============================================================================

export interface DailyBucket {
  /** ISO date string: YYYY-MM-DD */
  date: string;
  outputTokens: number;
  totalTokens: number;
  sessions: number;
  /** All models seen on this day */
  models: string[];
}

export interface HourlyBucket {
  /** 0–23 */
  hour: number;
  /** Average output tokens across all days this hour had activity */
  avgOutputTokens: number;
  /** Peak output tokens in a single day at this hour */
  peakOutputTokens: number;
  /** ISO date of the peak */
  peakDate: string;
}

// =============================================================================
// Session Detail
// =============================================================================

export interface AnalyticsSession {
  sessionId: string;
  /** ISO timestamp */
  startTime: string;
  /** ISO timestamp */
  endTime: string;
  durationMs: number;
  outputTokens: number;
  totalTokens: number;
  /** Primary model (first seen) */
  model: string;
  /** First real user message, truncated to 120 chars */
  firstMessage: string;
  isSubagent: boolean;
  toolCallCount: number;
  toolFailureCount: number;
}

// =============================================================================
// Usage Insights Signals
// =============================================================================

export interface PeakHourSignal {
  detected: true;
  /** Hours (0–23) where significant activity was concentrated */
  hours: number[];
  /** Number of days with significant late-hour activity */
  sessionCount: number;
  /** Fraction of total output tokens in those hours */
  tokenShare: number;
}

export interface RetryLoopSignal {
  detected: true;
  /** Number of sessions with high failure rate */
  affectedSessions: number;
  /** Average tool failure rate across affected sessions (0–1) */
  avgFailureRate: number;
}

export interface ContextThrashSignal {
  detected: true;
  /** Number of sessions with low output/total ratio */
  affectedSessions: number;
  /** Average output/total ratio across affected sessions (0–1) */
  avgRatio: number;
}

export interface ShortSessionChurnSignal {
  detected: true;
  /** Number of short restart-like sessions */
  count: number;
  /** Fraction of total sessions */
  percentage: number;
}

export interface InsightSignals {
  /** Significant activity between midnight and 4am on 3+ days */
  peakHourWarning: PeakHourSignal | null;
  /** High tool failure rate (>30%) in 5+ sessions */
  retryLoopWarning: RetryLoopSignal | null;
  /** Low output/context ratio (<5%) in 5+ sessions */
  contextThrashWarning: ContextThrashSignal | null;
  /** Many very short sessions (<2 min, <10K tokens) */
  shortSessionChurn: ShortSessionChurnSignal | null;
}

// =============================================================================
// Value Ratio
// =============================================================================

export interface ValueRatio {
  /** Total API-equivalent cost at public pricing */
  apiEquivalentUsd: number;
  /** API-equivalent cost for current calendar month */
  thisMonthUsd: number;
  /**
   * Estimated monthly Max subscription cost, if applicable.
   * Null if unknown or N/A (e.g. API user).
   */
  estimatedMaxSubscriptionUsd: number | null;
  /**
   * apiEquivalentUsd / estimatedMaxSubscriptionUsd.
   * Null if estimatedMaxSubscriptionUsd is null or zero.
   */
  ratio: number | null;
}

// =============================================================================
// Top-Level Summary
// =============================================================================

export interface ProjectAnalyticsSummary {
  projectId: string;
  projectName: string;
  projectPath: string;

  dateRange: {
    /** ISO date of first session */
    first: string;
    /** ISO date of last session */
    last: string;
  };
  /** Number of distinct calendar days with activity */
  daysActive: number;

  totals: {
    outputTokens: number;
    totalTokens: number;
    sessions: number;
    apiEquivalentCostUsd: number;
  };

  /** One entry per day with activity, ascending by date */
  daily: DailyBucket[];

  /** One entry per hour (0–23), only hours with any activity */
  hourly: HourlyBucket[];

  /** Per-model breakdown scoped to this project — same shape as UsageSummary.byModel */
  byModel: ModelUsage[];

  /** All sessions, default-sorted by totalTokens descending */
  sessions: AnalyticsSession[];

  peakDay: {
    date: string;
    outputTokens: number;
    totalTokens: number;
    sessions: number;
  } | null;

  peakHour: {
    hour: number;
    date: string;
    outputTokens: number;
  } | null;

  longestStreak: {
    startDate: string;
    endDate: string;
    days: number;
    totalTokens: number;
  } | null;

  valueRatio: ValueRatio;

  insights: InsightSignals;
}
