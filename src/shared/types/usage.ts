/**
 * Usage / token tracking types shared between main and renderer.
 */

// =============================================================================
// Summary Aggregates
// =============================================================================

export interface UsagePeriod {
  costUsd: number;
  sessions: number;
  outputTokens: number;
}

export interface DayUsage {
  /** ISO date string: YYYY-MM-DD */
  date: string;
  costUsd: number;
  sessions: number;
  outputTokens: number;
}

export interface ProjectUsage {
  projectId: string;
  projectName: string;
  /** Full filesystem path for tooltip disambiguation */
  projectPath: string;
  costUsd: number;
  sessions: number;
  outputTokens: number;
  /** output + input + cacheRead + cacheWrite — used for ranking */
  totalTokens: number;
  /** 0–1 fraction relative to top project's output tokens */
  outputFraction: number;
  /** 0–1 fraction relative to top project's total tokens */
  fraction: number;
}

export interface ModelUsage {
  /** Raw model string (e.g. "claude-sonnet-4-6") */
  model: string;
  /** Human-readable display label */
  label: string;
  costUsd: number;
  sessions: number;
  outputTokens: number;
  /** 0–1 fraction of total output tokens */
  fraction: number;
}

export interface SessionUsage {
  sessionId: string;
  projectId: string;
  projectName: string;
  costUsd: number;
  outputTokens: number;
  /** output + input + cacheRead + cacheWrite — used for ranking */
  totalTokens: number;
  /** ISO date string: YYYY-MM-DD */
  date: string;
  firstMessage?: string;
}

// =============================================================================
// Top-level Response
// =============================================================================

export interface UsageSummary {
  totals: {
    today: UsagePeriod;
    week: UsagePeriod;
    month: UsagePeriod;
    allTime: UsagePeriod;
  };
  /** Last 30 days, ascending by date */
  daily: DayUsage[];
  /** Sorted by cost desc */
  byProject: ProjectUsage[];
  /** Sorted by cost desc */
  byModel: ModelUsage[];
  /** Top 10 most expensive sessions */
  topSessions: SessionUsage[];
  /** Unix ms when this summary was computed */
  generatedAt: number;
}
