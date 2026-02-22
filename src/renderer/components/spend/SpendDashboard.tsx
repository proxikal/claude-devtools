/**
 * SpendDashboard - Cost visibility panel for Claude API usage.
 *
 * Shows token costs estimated from local JSONL session files.
 * Data flows: main/ipc/spend → preload → window.electronAPI.spend.getSummary()
 *
 * Sections:
 *   1. Period stat cards (Today / Week / Month / All Time)
 *   2. 14-day bar chart (CSS-only, no chart lib)
 *   3. By Project breakdown
 *   4. By Model breakdown
 *   5. Top Sessions list
 */

import { useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { formatCostUsd } from '@shared/utils/costEstimator';
import { AlertCircle, Clock, DollarSign, Info, Loader2, TrendingUp, Zap } from 'lucide-react';

import type { SpendPeriod, SpendSummary } from '@shared/types/spend';

// =============================================================================
// Helpers
// =============================================================================

function formatTokensK(n: number): string {
  if (n === 0) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function relativeDate(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr);
  const diffDays = Math.round((now.setHours(0, 0, 0, 0) - d.setHours(0, 0, 0, 0)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// =============================================================================
// Stat Card
// =============================================================================

interface StatCardProps {
  label: string;
  period: SpendPeriod;
  highlight?: boolean;
}

const StatCard = ({ label, period, highlight }: StatCardProps): React.JSX.Element => (
  <div
    className="flex flex-col gap-1.5 rounded-xl p-4"
    style={{
      backgroundColor: highlight ? 'var(--color-surface-raised)' : 'transparent',
      border: `1px solid ${highlight ? 'var(--color-border-emphasis)' : 'var(--color-border)'}`,
    }}
  >
    <span
      className="text-xs font-medium uppercase tracking-wider"
      style={{ color: 'var(--color-text-muted)' }}
    >
      {label}
    </span>
    <span className="text-2xl font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>
      {formatCostUsd(period.costUsd)}
    </span>
    <div className="flex items-center gap-3">
      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {period.sessions} {period.sessions === 1 ? 'session' : 'sessions'}
      </span>
      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {formatTokensK(period.outputTokens)} out
      </span>
    </div>
  </div>
);

// =============================================================================
// Bar Chart (CSS-only, 14-day window)
// =============================================================================

interface BarChartProps {
  daily: SpendSummary['daily'];
}

const BarChart = ({ daily }: BarChartProps): React.JSX.Element => {
  // Build a dense 14-day window ending today, filling missing days with zeros
  const todayStr = new Date().toISOString().slice(0, 10);
  const lookup = new Map(daily.map((d) => [d.date, d]));
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    const date = d.toISOString().slice(0, 10);
    return lookup.get(date) ?? { date, costUsd: 0, sessions: 0 };
  });

  const maxCost = Math.max(...days.map((d) => d.costUsd), 0.0001);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-24 items-end gap-1">
        {days.map((day) => {
          const heightPct = Math.max((day.costUsd / maxCost) * 100, day.costUsd > 0 ? 4 : 0);
          const isToday = day.date === todayStr;
          return (
            <div
              key={day.date}
              className="group relative flex flex-1 flex-col items-center justify-end"
              title={`${relativeDate(day.date)}: ${formatCostUsd(day.costUsd)} · ${day.sessions} sessions`}
            >
              <div
                className="w-full rounded-t-sm transition-opacity group-hover:opacity-70"
                style={{
                  height: `${heightPct}%`,
                  minHeight: day.costUsd > 0 ? '3px' : '0',
                  backgroundColor: isToday ? '#6366f1' : 'var(--color-border-emphasis)',
                }}
              />
            </div>
          );
        })}
      </div>
      {/* X-axis labels: first, middle, last */}
      <div className="flex justify-between px-0">
        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
          {relativeDate(days[0].date)}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
          {relativeDate(days[6].date)}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
          {relativeDate(days[13].date)}
        </span>
      </div>
    </div>
  );
};

// =============================================================================
// Section Header
// =============================================================================

const SectionHeader = ({ title }: { title: string }): React.JSX.Element => (
  <div
    className="mb-3 flex items-center gap-2 pb-2"
    style={{ borderBottom: '1px solid var(--color-border)' }}
  >
    <span
      className="text-xs font-semibold uppercase tracking-wider"
      style={{ color: 'var(--color-text-muted)' }}
    >
      {title}
    </span>
  </div>
);

// =============================================================================
// Fraction Bar
// =============================================================================

const FractionBar = ({
  fraction,
  color = '#6366f1',
}: {
  fraction: number;
  color?: string;
}): React.JSX.Element => (
  <div
    className="h-1 w-full overflow-hidden rounded-full"
    style={{ backgroundColor: 'var(--color-border)' }}
  >
    <div
      className="h-full rounded-full"
      style={{
        width: `${Math.max(fraction * 100, fraction > 0 ? 2 : 0)}%`,
        backgroundColor: color,
      }}
    />
  </div>
);

// =============================================================================
// Main Component
// =============================================================================

export const SpendDashboard = (): React.JSX.Element => {
  const [summary, setSummary] = useState<SpendSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    void api.spend
      .getSummary()
      .then((data) => {
        setSummary(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load spend data');
        setLoading(false);
      });
  }, []);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-6 animate-spin" />
          <span className="text-sm">Analyzing session costs…</span>
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (error || !summary) {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <div className="flex flex-col items-center gap-3">
          <AlertCircle className="size-6 text-red-400" />
          <span className="text-sm">{error ?? 'No data available'}</span>
        </div>
      </div>
    );
  }

  const { totals, daily, byProject, byModel, topSessions } = summary;

  return (
    <div
      className="flex flex-1 flex-col overflow-y-auto"
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        {/* ── Page header ─────────────────────────────────────────────────── */}
        <div className="mb-8 flex items-center gap-3">
          <div
            className="flex size-9 items-center justify-center rounded-lg"
            style={{
              backgroundColor: 'var(--color-surface-raised)',
              border: '1px solid var(--color-border)',
            }}
          >
            <TrendingUp className="size-4" style={{ color: '#6366f1' }} />
          </div>
          <div>
            <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
              Usage Dashboard
            </h1>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              API-equivalent cost of your Claude Code sessions
            </p>
          </div>
        </div>

        {/* ── Subscription disclaimer banner ───────────────────────────────── */}
        <div
          className="mb-8 flex gap-3 rounded-xl p-4"
          style={{
            backgroundColor: 'rgba(99, 102, 241, 0.08)',
            border: '1px solid rgba(99, 102, 241, 0.25)',
          }}
        >
          <Info className="mt-0.5 size-4 shrink-0" style={{ color: '#818cf8' }} />
          <div>
            <p className="text-sm font-medium" style={{ color: '#a5b4fc' }}>
              These are not your actual charges
            </p>
            <p
              className="mt-1 text-xs leading-relaxed"
              style={{ color: 'var(--color-text-muted)' }}
            >
              If you use a Claude Max subscription, you pay a flat monthly rate — not per token. The
              figures below show what equivalent usage would cost at public API prices. Subscription
              users often see 20–100× more compute value than their monthly fee.
            </p>
          </div>
        </div>

        {/* ── Stat cards ──────────────────────────────────────────────────── */}
        <div className="mb-8 grid grid-cols-4 gap-3">
          <StatCard label="Today" period={totals.today} highlight />
          <StatCard label="This Week" period={totals.week} />
          <StatCard label="This Month" period={totals.month} />
          <StatCard label="All Time" period={totals.allTime} />
        </div>

        {/* ── 14-day activity chart ────────────────────────────────────────── */}
        <div className="mb-8 rounded-xl p-4" style={{ border: '1px solid var(--color-border)' }}>
          <div className="mb-3 flex items-center justify-between">
            <span
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--color-text-muted)' }}
            >
              14-Day Activity
            </span>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              <span style={{ color: '#6366f1' }}>■</span> today
            </span>
          </div>
          <BarChart daily={daily} />
        </div>

        {/* ── By Project ──────────────────────────────────────────────────── */}
        {byProject.length > 0 && (
          <div className="mb-8">
            <SectionHeader title="By Project" />
            <div className="space-y-3">
              {byProject.slice(0, 10).map((proj) => (
                <div key={proj.projectId} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span
                      className="truncate text-sm font-medium"
                      style={{ color: 'var(--color-text)' }}
                    >
                      {proj.projectName}
                    </span>
                    <div className="ml-4 flex shrink-0 items-center gap-3">
                      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        {proj.sessions} sessions
                      </span>
                      <span
                        className="w-14 text-right text-sm font-semibold tabular-nums"
                        style={{ color: 'var(--color-text)' }}
                      >
                        {formatCostUsd(proj.costUsd)}
                      </span>
                    </div>
                  </div>
                  <FractionBar fraction={proj.fraction} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── By Model ────────────────────────────────────────────────────── */}
        {byModel.length > 0 && (
          <div className="mb-8">
            <SectionHeader title="By Model" />
            <div className="space-y-3">
              {byModel.map((m) => (
                <div key={m.model} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Zap
                        className="size-3.5 shrink-0"
                        style={{ color: 'var(--color-text-muted)' }}
                      />
                      <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                        {m.label}
                      </span>
                    </div>
                    <div className="ml-4 flex shrink-0 items-center gap-3">
                      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        {m.sessions} sessions
                      </span>
                      <span
                        className="w-14 text-right text-sm font-semibold tabular-nums"
                        style={{ color: 'var(--color-text)' }}
                      >
                        {formatCostUsd(m.costUsd)}
                      </span>
                    </div>
                  </div>
                  <FractionBar fraction={m.fraction} color="#10b981" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Top Sessions ────────────────────────────────────────────────── */}
        {topSessions.length > 0 && (
          <div className="mb-8">
            <SectionHeader title="Top Sessions" />
            <div className="space-y-1">
              {topSessions.map((s) => (
                <div
                  key={s.sessionId}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5"
                  style={{ border: '1px solid var(--color-border)' }}
                >
                  <DollarSign
                    className="size-3.5 shrink-0"
                    style={{ color: 'var(--color-text-muted)' }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm" style={{ color: 'var(--color-text)' }}>
                        {s.firstMessage ?? s.sessionId.slice(0, 12)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        {s.projectName}
                      </span>
                      <span
                        className="text-[10px]"
                        style={{ color: 'var(--color-border-emphasis)' }}
                      >
                        ·
                      </span>
                      <Clock
                        className="size-3 shrink-0"
                        style={{ color: 'var(--color-text-muted)' }}
                      />
                      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        {relativeDate(s.date)}
                      </span>
                      <span
                        className="text-[10px]"
                        style={{ color: 'var(--color-border-emphasis)' }}
                      >
                        ·
                      </span>
                      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        {formatTokensK(s.outputTokens)} out
                      </span>
                    </div>
                  </div>
                  <span
                    className="shrink-0 text-sm font-semibold tabular-nums"
                    style={{ color: 'var(--color-text)' }}
                  >
                    {formatCostUsd(s.costUsd)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Empty state ──────────────────────────────────────────────────── */}
        {totals.allTime.sessions === 0 && (
          <div
            className="flex flex-col items-center gap-3 py-16"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <TrendingUp className="size-10 opacity-30" />
            <p className="text-sm">No session data found yet.</p>
            <p className="text-xs">Run Claude Code in a project to start tracking spend.</p>
          </div>
        )}

        {/* ── Footer note ─────────────────────────────────────────────────── */}
        <p
          className="mt-4 text-center text-xs leading-relaxed"
          style={{ color: 'var(--color-text-muted)' }}
        >
          API-equivalent costs calculated from Anthropic public pricing (Feb 2026).
          <br />
          Token data sourced from <code className="font-mono">~/.claude/projects/</code> JSONL
          files.
        </p>
      </div>
    </div>
  );
};
