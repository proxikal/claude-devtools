import { describe, expect, it } from 'vitest';

import {
  buildProjectAnalyticsSummary,
  computeInsights,
  computeLongestStreak,
  computeSessionCost,
  computeValueRatio,
  type ProjectDescriptor,
} from '../../../src/main/utils/analyticsAggregator';
import type { SessionTimeSeriesData } from '../../../src/main/utils/jsonl';

// =============================================================================
// Fixtures
// =============================================================================

const PROJECT: ProjectDescriptor = {
  projectId: 'test-project',
  projectName: 'Test Project',
  projectPath: '/Users/test/project',
};

function makeSession(overrides: Partial<SessionTimeSeriesData> = {}): SessionTimeSeriesData {
  return {
    date: '2026-02-10',
    startTime: '2026-02-10T10:00:00.000Z',
    endTime: '2026-02-10T11:00:00.000Z',
    durationMs: 3600000,
    outputTokens: 1000,
    totalTokens: 10000,
    model: 'claude-sonnet-4-6',
    modelBreakdown: {
      'claude-sonnet-4-6': {
        inputTokens: 8000,
        outputTokens: 1000,
        cacheReadTokens: 1000,
        cacheCreationTokens: 0,
      },
    },
    firstMessage: 'Hello, world',
    isSubagent: false,
    toolCallCount: 4,
    toolFailureCount: 0,
    startHour: 10,
    ...overrides,
  };
}

// =============================================================================
// Empty project
// =============================================================================

describe('buildProjectAnalyticsSummary', () => {
  it('handles empty session list', () => {
    const result = buildProjectAnalyticsSummary(PROJECT, []);
    expect(result.totals.sessions).toBe(0);
    expect(result.totals.outputTokens).toBe(0);
    expect(result.daily).toHaveLength(0);
    expect(result.sessions).toHaveLength(0);
    expect(result.peakDay).toBeNull();
    expect(result.longestStreak).toBeNull();
  });

  // ── Single session ──────────────────────────────────────────────────────────

  it('aggregates a single session correctly', () => {
    const session = makeSession();
    const result = buildProjectAnalyticsSummary(PROJECT, [session]);

    expect(result.totals.sessions).toBe(1);
    expect(result.totals.outputTokens).toBe(1000);
    expect(result.totals.totalTokens).toBe(10000);
    expect(result.daily).toHaveLength(1);
    expect(result.daily[0].date).toBe('2026-02-10');
    expect(result.dateRange.first).toBe('2026-02-10');
    expect(result.dateRange.last).toBe('2026-02-10');
    expect(result.daysActive).toBe(1);
  });

  // ── Multi-session with model switching ──────────────────────────────────────

  it('handles multi-session with model switching', () => {
    const s1 = makeSession({
      date: '2026-02-10',
      outputTokens: 1000,
      totalTokens: 10000,
      model: 'claude-sonnet-4-6',
      modelBreakdown: {
        'claude-sonnet-4-6': {
          inputTokens: 8000,
          outputTokens: 1000,
          cacheReadTokens: 1000,
          cacheCreationTokens: 0,
        },
      },
    });
    const s2 = makeSession({
      date: '2026-02-11',
      outputTokens: 2000,
      totalTokens: 20000,
      model: 'claude-opus-4-6',
      modelBreakdown: {
        'claude-opus-4-6': {
          inputTokens: 16000,
          outputTokens: 2000,
          cacheReadTokens: 2000,
          cacheCreationTokens: 0,
        },
      },
    });

    const result = buildProjectAnalyticsSummary(PROJECT, [s1, s2]);

    expect(result.totals.sessions).toBe(2);
    expect(result.totals.outputTokens).toBe(3000);
    expect(result.daily).toHaveLength(2);
    expect(result.byModel).toHaveLength(2);
    expect(result.byModel[0].model).toBe('claude-opus-4-6'); // higher output
  });

  // ── Subagent sessions are counted independently ─────────────────────────────

  it('includes subagent sessions in totals without double counting', () => {
    const main = makeSession({ outputTokens: 1000, totalTokens: 10000, isSubagent: false });
    const sub = makeSession({ outputTokens: 500, totalTokens: 5000, isSubagent: true });

    const result = buildProjectAnalyticsSummary(PROJECT, [main, sub]);

    expect(result.totals.sessions).toBe(2);
    expect(result.totals.outputTokens).toBe(1500);
    expect(result.totals.totalTokens).toBe(15000);
    // Both appear in sessions list
    expect(result.sessions.some((s) => s.isSubagent)).toBe(true);
    expect(result.sessions.some((s) => !s.isSubagent)).toBe(true);
  });
});

// =============================================================================
// Streak calculation
// =============================================================================

describe('computeLongestStreak', () => {
  it('returns null for empty input', () => {
    expect(computeLongestStreak([])).toBeNull();
  });

  it('returns a streak of 1 for a single day', () => {
    const result = computeLongestStreak([
      { date: '2026-02-10', outputTokens: 100, totalTokens: 1000, sessions: 1, models: [] },
    ]);
    expect(result?.days).toBe(1);
    expect(result?.startDate).toBe('2026-02-10');
    expect(result?.endDate).toBe('2026-02-10');
  });

  it('detects a 3-day consecutive streak', () => {
    const daily = [
      { date: '2026-02-10', outputTokens: 100, totalTokens: 1000, sessions: 1, models: [] },
      { date: '2026-02-11', outputTokens: 200, totalTokens: 2000, sessions: 1, models: [] },
      { date: '2026-02-12', outputTokens: 150, totalTokens: 1500, sessions: 1, models: [] },
    ];
    const result = computeLongestStreak(daily);
    expect(result?.days).toBe(3);
    expect(result?.startDate).toBe('2026-02-10');
    expect(result?.endDate).toBe('2026-02-12');
    expect(result?.totalTokens).toBe(4500);
  });

  it('handles a gap in the middle, picks the longer streak', () => {
    const daily = [
      { date: '2026-02-10', outputTokens: 100, totalTokens: 1000, sessions: 1, models: [] },
      { date: '2026-02-11', outputTokens: 100, totalTokens: 1000, sessions: 1, models: [] },
      // gap: 2026-02-12 missing
      { date: '2026-02-13', outputTokens: 100, totalTokens: 1000, sessions: 1, models: [] },
      { date: '2026-02-14', outputTokens: 100, totalTokens: 1000, sessions: 1, models: [] },
      { date: '2026-02-15', outputTokens: 100, totalTokens: 1000, sessions: 1, models: [] },
    ];
    const result = computeLongestStreak(daily);
    expect(result?.days).toBe(3);
    expect(result?.startDate).toBe('2026-02-13');
  });
});

// =============================================================================
// Session cost
// =============================================================================

describe('computeSessionCost', () => {
  it('returns 0 for a session with no model breakdown', () => {
    const s = makeSession({ modelBreakdown: {} });
    expect(computeSessionCost(s)).toBe(0);
  });

  it('returns a positive cost for a session with tokens', () => {
    const s = makeSession();
    expect(computeSessionCost(s)).toBeGreaterThan(0);
  });

  it('sums cost across multiple models in a session', () => {
    const s = makeSession({
      modelBreakdown: {
        'claude-sonnet-4-6': {
          inputTokens: 1000,
          outputTokens: 100,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
        'claude-opus-4-6': {
          inputTokens: 1000,
          outputTokens: 100,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
      },
    });
    const cost = computeSessionCost(s);
    expect(cost).toBeGreaterThan(0);
  });
});

// =============================================================================
// Value ratio
// =============================================================================

describe('computeValueRatio', () => {
  it('returns null ratio for zero cost', () => {
    const result = computeValueRatio([], 0);
    expect(result.ratio).toBeNull();
    expect(result.apiEquivalentUsd).toBe(0);
  });

  it('computes a ratio when cost is positive', () => {
    const result = computeValueRatio([], 1000);
    expect(result.ratio).toBe(5); // 1000 / 200 = 5
    expect(result.estimatedMaxSubscriptionUsd).toBe(200);
  });
});

// =============================================================================
// Insight signals
// =============================================================================

describe('computeInsights', () => {
  it('returns all null signals for a clean project', () => {
    const sessions = Array.from({ length: 3 }, () => makeSession());
    const result = computeInsights(sessions, sessions, []);
    expect(result.peakHourWarning).toBeNull();
    expect(result.retryLoopWarning).toBeNull();
    expect(result.contextThrashWarning).toBeNull();
    expect(result.shortSessionChurn).toBeNull();
  });

  it('detects retry loop pattern', () => {
    const sessions = Array.from(
      { length: 6 },
      () => makeSession({ toolCallCount: 10, toolFailureCount: 4 }) // 40% failure rate
    );
    const result = computeInsights(sessions, sessions, []);
    expect(result.retryLoopWarning).not.toBeNull();
    expect(result.retryLoopWarning?.detected).toBe(true);
    expect(result.retryLoopWarning?.affectedSessions).toBe(6);
  });

  it('does not flag retry loops below threshold', () => {
    const sessions = Array.from(
      { length: 6 },
      () => makeSession({ toolCallCount: 10, toolFailureCount: 1 }) // 10% failure rate
    );
    const result = computeInsights(sessions, sessions, []);
    expect(result.retryLoopWarning).toBeNull();
  });

  it('detects context thrash pattern', () => {
    const sessions = Array.from(
      { length: 6 },
      () => makeSession({ outputTokens: 100, totalTokens: 100000 }) // 0.1% output ratio
    );
    const result = computeInsights(sessions, sessions, []);
    expect(result.contextThrashWarning).not.toBeNull();
    expect(result.contextThrashWarning?.detected).toBe(true);
  });

  it('detects short session churn', () => {
    const shortSessions = Array.from(
      { length: 4 },
      () => makeSession({ durationMs: 60000, totalTokens: 500 }) // 1 min, 500 tokens
    );
    const normalSessions = Array.from({ length: 6 }, () => makeSession());
    const all = [...shortSessions, ...normalSessions];
    const result = computeInsights(all, all, []);
    expect(result.shortSessionChurn).not.toBeNull();
    expect(result.shortSessionChurn?.count).toBe(4);
  });
});
