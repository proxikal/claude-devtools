/**
 * Spend / cost tracking types shared between main and renderer.
 */

// =============================================================================
// Summary Aggregates
// =============================================================================

export interface SpendPeriod {
  costUsd: number;
  sessions: number;
  outputTokens: number;
}

export interface DaySpend {
  /** ISO date string: YYYY-MM-DD */
  date: string;
  costUsd: number;
  sessions: number;
}

export interface ProjectSpend {
  projectId: string;
  projectName: string;
  costUsd: number;
  sessions: number;
  outputTokens: number;
  /** 0–1, fraction of top project's cost */
  fraction: number;
}

export interface ModelSpend {
  /** Raw model string (e.g. "claude-sonnet-4-6") */
  model: string;
  /** Human-readable display label */
  label: string;
  costUsd: number;
  sessions: number;
  /** 0–1 fraction of total cost */
  fraction: number;
}

export interface SessionSpend {
  sessionId: string;
  projectId: string;
  projectName: string;
  costUsd: number;
  outputTokens: number;
  /** ISO date string: YYYY-MM-DD */
  date: string;
  firstMessage?: string;
}

// =============================================================================
// Top-level Response
// =============================================================================

export interface SpendSummary {
  totals: {
    today: SpendPeriod;
    week: SpendPeriod;
    month: SpendPeriod;
    allTime: SpendPeriod;
  };
  /** Last 30 days, ascending by date */
  daily: DaySpend[];
  /** Sorted by cost desc */
  byProject: ProjectSpend[];
  /** Sorted by cost desc */
  byModel: ModelSpend[];
  /** Top 10 most expensive sessions */
  topSessions: SessionSpend[];
  /** Unix ms when this summary was computed */
  generatedAt: number;
}
