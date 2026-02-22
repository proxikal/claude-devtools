/**
 * ProjectAnalyticsPanel
 *
 * Full-screen replacement for the UsageDashboard content area when a project
 * is selected. Loads ProjectAnalyticsSummary via IPC and renders all analytics
 * sections. Back button returns to the usage overview.
 *
 * Phases:
 *   Phase 2 — shell, back button, loading/error state  ✓
 *   Phase 3 — summary header + activity chart           ← current
 *   Phase 4 — model breakdown + value section
 *   Phase 5 — sessions list
 *   Phase 6 — polish
 *   Phase 7 — usage insights
 */

import { useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { formatCostUsd } from '@shared/utils/usageEstimator';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';

import type { DailyBucket, ProjectAnalyticsSummary } from '@shared/types/projectAnalytics';

// =============================================================================
// Helpers
// =============================================================================

function formatTokensLarge(n: number): string {
  if (!n || !isFinite(n)) return '0';
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
}

function formatDateShort(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateFull(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatHour(hour: number): string {
  if (hour === 0) return '12am';
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return '12pm';
  return `${hour - 12}pm`;
}

// =============================================================================
// Props
// =============================================================================

interface ProjectAnalyticsPanelProps {
  projectId: string;
  projectName: string;
  projectPath: string;
  onBack: () => void;
}

// =============================================================================
// Summary Header
// =============================================================================

interface SummaryHeaderProps {
  summary: ProjectAnalyticsSummary;
}

const SummaryHeader = ({ summary }: SummaryHeaderProps): React.JSX.Element => {
  const { totals, dateRange, daysActive } = summary;
  const hasRange = dateRange.first !== dateRange.last;

  return (
    <div className="mb-8">
      {/* Top stat row */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div
          className="flex flex-col gap-1 rounded-xl p-4"
          style={{
            border: '1px solid var(--color-border-emphasis)',
            backgroundColor: 'var(--color-surface-raised)',
          }}
        >
          <span
            className="text-xs font-medium uppercase tracking-wider"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Output Tokens
          </span>
          <span
            className="text-2xl font-semibold tabular-nums"
            style={{ color: 'var(--color-text)' }}
          >
            {formatTokensLarge(totals.outputTokens)}
          </span>
          <span
            className="text-[10px] font-medium uppercase tracking-wider"
            style={{ color: 'var(--color-text-muted)' }}
          >
            all time
          </span>
        </div>

        <div
          className="flex flex-col gap-1 rounded-xl p-4"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <span
            className="text-xs font-medium uppercase tracking-wider"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Total Context
          </span>
          <span
            className="text-2xl font-semibold tabular-nums"
            style={{ color: 'var(--color-text)' }}
          >
            {formatTokensLarge(totals.totalTokens)}
          </span>
          <span
            className="text-[10px] font-medium uppercase tracking-wider"
            style={{ color: 'var(--color-text-muted)' }}
          >
            tokens processed
          </span>
        </div>

        <div
          className="flex flex-col gap-1 rounded-xl p-4"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <span
            className="text-xs font-medium uppercase tracking-wider"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Sessions
          </span>
          <span
            className="text-2xl font-semibold tabular-nums"
            style={{ color: 'var(--color-text)' }}
          >
            {totals.sessions.toLocaleString('en-US')}
          </span>
          <span
            className="text-[10px] font-medium uppercase tracking-wider"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {daysActive} {daysActive === 1 ? 'day' : 'days'} active
          </span>
        </div>
      </div>

      {/* Date range */}
      {hasRange && (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {formatDateFull(dateRange.first)} → {formatDateFull(dateRange.last)}
        </p>
      )}
    </div>
  );
};

// =============================================================================
// Activity Bar Chart
// =============================================================================

type ChartRange = '30' | '90' | 'all';

interface ActivityChartProps {
  daily: DailyBucket[];
  peakDate: string | null;
}

const ActivityChart = ({ daily, peakDate }: ActivityChartProps): React.JSX.Element => {
  const [range, setRange] = useState<ChartRange>('30');

  const todayStr = new Date().toISOString().slice(0, 10);
  const lookup = new Map(daily.map((d) => [d.date, d]));

  // Build the dense day window based on selected range
  const days = ((): DailyBucket[] => {
    if (range === 'all') {
      // Span from first activity day to today
      if (daily.length === 0) return [];
      const firstDate = new Date(daily[0].date + 'T00:00:00');
      const today = new Date(todayStr + 'T00:00:00');
      const totalDays = Math.round((today.getTime() - firstDate.getTime()) / 86_400_000) + 1;
      return Array.from({ length: totalDays }, (_, i) => {
        const d = new Date(firstDate);
        d.setDate(d.getDate() + i);
        const date = d.toISOString().slice(0, 10);
        return (
          lookup.get(date) ?? { date, outputTokens: 0, totalTokens: 0, sessions: 0, models: [] }
        );
      });
    }

    const count = range === '30' ? 30 : 90;
    return Array.from({ length: count }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (count - 1 - i));
      const date = d.toISOString().slice(0, 10);
      return lookup.get(date) ?? { date, outputTokens: 0, totalTokens: 0, sessions: 0, models: [] };
    });
  })();

  const maxTokens = Math.max(...days.map((d) => d.outputTokens ?? 0), 1);

  // X-axis labels: first, middle, last
  const labelDays =
    days.length > 1
      ? [days[0], days[Math.floor((days.length - 1) / 2)], days[days.length - 1]]
      : days.length === 1
        ? [days[0]]
        : [];

  const PEAK_COLOR = '#f59e0b'; // amber for peak
  const TODAY_COLOR = '#6366f1'; // indigo for today
  const DEFAULT_COLOR = 'var(--color-border-emphasis)';

  return (
    <div className="mb-8 rounded-xl p-4" style={{ border: '1px solid var(--color-border)' }}>
      {/* Header row */}
      <div className="mb-3 flex items-center justify-between">
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Activity
        </span>
        <div className="flex items-center gap-3">
          {/* Legend */}
          <div
            className="flex items-center gap-3 text-[10px]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {peakDate && (
              <span>
                <span style={{ color: PEAK_COLOR }}>■</span> peak day
              </span>
            )}
            <span>
              <span style={{ color: TODAY_COLOR }}>■</span> today
            </span>
          </div>
          {/* Range toggle */}
          <div
            className="flex overflow-hidden rounded-md"
            style={{ border: '1px solid var(--color-border)' }}
          >
            {(['30', '90', 'all'] as ChartRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className="px-2.5 py-0.5 text-[10px] font-medium transition-colors"
                style={{
                  color: range === r ? 'var(--color-text)' : 'var(--color-text-muted)',
                  backgroundColor: range === r ? 'var(--color-surface-raised)' : 'transparent',
                }}
              >
                {r === 'all' ? 'All' : `${r}d`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bars */}
      {days.length === 0 ? (
        <div
          className="flex h-24 items-center justify-center text-xs"
          style={{ color: 'var(--color-text-muted)' }}
        >
          No data
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="flex h-24 gap-px">
            {days.map((day) => {
              const tokens = day.outputTokens ?? 0;
              const heightPct = Math.max((tokens / maxTokens) * 100, tokens > 0 ? 4 : 0);
              const isToday = day.date === todayStr;
              const isPeak = peakDate !== null && day.date === peakDate;
              const color = isPeak ? PEAK_COLOR : isToday ? TODAY_COLOR : DEFAULT_COLOR;
              return (
                <div
                  key={day.date}
                  className="group relative flex flex-1 flex-col justify-end"
                  title={`${formatDateShort(day.date)}: ${formatTokensLarge(tokens)} output tokens · ${day.sessions} ${day.sessions === 1 ? 'session' : 'sessions'}`}
                >
                  <div
                    className="w-full rounded-t-sm transition-opacity group-hover:opacity-70"
                    style={{
                      height: `${heightPct}%`,
                      minHeight: tokens > 0 ? '3px' : '0',
                      backgroundColor: color,
                    }}
                  />
                </div>
              );
            })}
          </div>
          {/* X-axis */}
          {labelDays.length > 0 && (
            <div className="flex justify-between px-0">
              {labelDays.map((day, i) => (
                <span key={i} className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                  {formatDateShort(day.date)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// =============================================================================
// Peak Moments
// =============================================================================

interface PeakMomentsProps {
  summary: ProjectAnalyticsSummary;
}

const PeakMoments = ({ summary }: PeakMomentsProps): React.JSX.Element | null => {
  const { peakDay, peakHour, longestStreak } = summary;
  if (!peakDay && !peakHour && !longestStreak) return null;

  return (
    <div className="mb-8">
      {/* Section header */}
      <div className="mb-3 pb-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Peak Moments
        </span>
      </div>

      <div className="space-y-2">
        {peakDay && (
          <div
            className="flex items-center justify-between rounded-lg px-4 py-3"
            style={{ border: '1px solid var(--color-border)' }}
          >
            <div>
              <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                Busiest day
              </span>
              <p className="mt-0.5 text-sm" style={{ color: 'var(--color-text)' }}>
                {formatDateFull(peakDay.date)}
              </p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {peakDay.sessions} {peakDay.sessions === 1 ? 'session' : 'sessions'}
              </p>
            </div>
            <div className="text-right">
              <span className="text-lg font-semibold tabular-nums" style={{ color: '#f59e0b' }}>
                {formatTokensLarge(peakDay.outputTokens)}
              </span>
              <p
                className="text-[10px] font-medium uppercase"
                style={{ color: 'var(--color-text-muted)' }}
              >
                output tokens
              </p>
            </div>
          </div>
        )}

        {peakHour && (
          <div
            className="flex items-center justify-between rounded-lg px-4 py-3"
            style={{ border: '1px solid var(--color-border)' }}
          >
            <div>
              <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                Busiest hour
              </span>
              <p className="mt-0.5 text-sm" style={{ color: 'var(--color-text)' }}>
                {formatHour(peakHour.hour)} on {formatDateFull(peakHour.date)}
              </p>
            </div>
            <div className="text-right">
              <span
                className="text-lg font-semibold tabular-nums"
                style={{ color: 'var(--color-text)' }}
              >
                {formatTokensLarge(peakHour.outputTokens)}
              </span>
              <p
                className="text-[10px] font-medium uppercase"
                style={{ color: 'var(--color-text-muted)' }}
              >
                output tokens
              </p>
            </div>
          </div>
        )}

        {longestStreak && longestStreak.days > 1 && (
          <div
            className="flex items-center justify-between rounded-lg px-4 py-3"
            style={{ border: '1px solid var(--color-border)' }}
          >
            <div>
              <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                Longest streak
              </span>
              <p className="mt-0.5 text-sm" style={{ color: 'var(--color-text)' }}>
                {formatDateShort(longestStreak.startDate)} →{' '}
                {formatDateShort(longestStreak.endDate)}
              </p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {formatTokensLarge(longestStreak.totalTokens)} total tokens
              </p>
            </div>
            <div className="text-right">
              <span
                className="text-lg font-semibold tabular-nums"
                style={{ color: 'var(--color-text)' }}
              >
                {longestStreak.days}
              </span>
              <p
                className="text-[10px] font-medium uppercase"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {longestStreak.days === 1 ? 'day' : 'days'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// =============================================================================
// By Model
// =============================================================================

interface ByModelProps {
  byModel: ProjectAnalyticsSummary['byModel'];
}

const ByModel = ({ byModel }: ByModelProps): React.JSX.Element | null => {
  if (byModel.length === 0) return null;

  const maxOutput = Math.max(...byModel.map((m) => m.outputTokens ?? 0), 1);

  return (
    <div className="mb-8">
      <div className="mb-3 pb-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--color-text-muted)' }}
        >
          By Model
        </span>
      </div>
      <div className="space-y-3">
        {byModel.map((m) => {
          const fraction = (m.outputTokens ?? 0) / maxOutput;
          return (
            <div key={m.model} className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                  {m.label}
                </span>
                <div className="ml-4 flex shrink-0 items-center gap-3">
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {m.sessions.toLocaleString('en-US')} {m.sessions === 1 ? 'session' : 'sessions'}
                  </span>
                  <span
                    className="w-16 text-right text-sm font-semibold tabular-nums"
                    style={{ color: 'var(--color-text)' }}
                  >
                    {formatTokensLarge(m.outputTokens ?? 0)}
                  </span>
                </div>
              </div>
              {/* Fraction bar */}
              <div
                className="h-1 w-full overflow-hidden rounded-full"
                style={{ backgroundColor: 'var(--color-border)' }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(fraction * 100, fraction > 0 ? 2 : 0)}%`,
                    backgroundColor: '#10b981',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// =============================================================================
// Value Section
// =============================================================================

interface ValueSectionProps {
  valueRatio: ProjectAnalyticsSummary['valueRatio'];
}

const ValueSection = ({ valueRatio }: ValueSectionProps): React.JSX.Element | null => {
  const { apiEquivalentUsd, thisMonthUsd, ratio } = valueRatio;
  if (!apiEquivalentUsd) return null;

  const showRatio = ratio !== null && ratio >= 1;

  return (
    <div className="mb-8">
      <div className="mb-3 pb-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--color-text-muted)' }}
        >
          API Equivalent Value
        </span>
      </div>

      {/* Ratio headline — the "holy shit" moment */}
      {showRatio && (
        <div
          className="mb-4 rounded-xl p-5 text-center"
          style={{
            background:
              'linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(16,185,129,0.08) 100%)',
            border: '1px solid rgba(99,102,241,0.3)',
          }}
        >
          <p
            className="mb-1 text-xs font-medium uppercase tracking-wider"
            style={{ color: 'rgba(165,180,252,0.8)' }}
          >
            If on Claude Max (~$200/mo)
          </p>
          <p className="text-5xl font-bold tabular-nums" style={{ color: '#a5b4fc' }}>
            {ratio.toLocaleString('en-US')}×
          </p>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            return on subscription for this project
          </p>
        </div>
      )}

      {/* All-time + this month breakdown */}
      <div className="grid grid-cols-2 gap-3">
        <div
          className="flex flex-col gap-1 rounded-xl p-4"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <span
            className="text-xs font-medium uppercase tracking-wider"
            style={{ color: 'var(--color-text-muted)' }}
          >
            All Time
          </span>
          <span
            className="text-2xl font-semibold tabular-nums"
            style={{ color: 'var(--color-text)' }}
          >
            {formatCostUsd(apiEquivalentUsd)}
          </span>
          <span
            className="text-[10px] font-medium uppercase"
            style={{ color: 'var(--color-text-muted)' }}
          >
            API equivalent
          </span>
        </div>
        <div
          className="flex flex-col gap-1 rounded-xl p-4"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <span
            className="text-xs font-medium uppercase tracking-wider"
            style={{ color: 'var(--color-text-muted)' }}
          >
            This Month
          </span>
          <span
            className="text-2xl font-semibold tabular-nums"
            style={{ color: 'var(--color-text)' }}
          >
            {formatCostUsd(thisMonthUsd)}
          </span>
          <span
            className="text-[10px] font-medium uppercase"
            style={{ color: 'var(--color-text-muted)' }}
          >
            API equivalent
          </span>
        </div>
      </div>

      <p className="mt-3 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
        Calculated at public Anthropic API pricing. If you use the API directly, these are your
        actual costs.
      </p>
    </div>
  );
};

// =============================================================================
// Sessions List
// =============================================================================

type SortKey = 'totalTokens' | 'date' | 'outputTokens';

interface SessionsListProps {
  sessions: ProjectAnalyticsSummary['sessions'];
}

function formatSessionTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/[*_~>#[\]!|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const SESSION_DEFAULT_LIMIT = 10;

const SessionsList = ({ sessions }: SessionsListProps): React.JSX.Element | null => {
  const [sort, setSort] = useState<SortKey>('totalTokens');
  const [showAll, setShowAll] = useState(false);

  if (sessions.length === 0) return null;

  const sorted = [...sessions].sort((a, b) => {
    if (sort === 'date') return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
    if (sort === 'outputTokens') return b.outputTokens - a.outputTokens;
    return b.totalTokens - a.totalTokens;
  });

  const visible = showAll ? sorted : sorted.slice(0, SESSION_DEFAULT_LIMIT);

  const sortLabel = (key: SortKey, label: string): React.JSX.Element => (
    <button
      onClick={() => setSort(key)}
      className="px-2 py-0.5 text-[10px] font-medium transition-colors"
      style={{
        color: sort === key ? 'var(--color-text)' : 'var(--color-text-muted)',
        backgroundColor: sort === key ? 'var(--color-surface-raised)' : 'transparent',
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="mb-8">
      {/* Header */}
      <div
        className="mb-3 flex items-center justify-between pb-2"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Sessions ({sessions.length.toLocaleString('en-US')})
        </span>
        <div
          className="flex overflow-hidden rounded-md"
          style={{ border: '1px solid var(--color-border)' }}
        >
          {sortLabel('totalTokens', 'Total')}
          {sortLabel('outputTokens', 'Output')}
          {sortLabel('date', 'Date')}
        </div>
      </div>

      {/* Rows */}
      <div className="space-y-1">
        {visible.map((s, i) => {
          const preview = s.firstMessage ? stripMarkdown(s.firstMessage).slice(0, 120) || '—' : '—';
          const truncated = s.firstMessage && stripMarkdown(s.firstMessage).length > 120;
          return (
            <div
              key={s.sessionId || `${s.startTime}-${i}`}
              className="flex flex-col gap-0.5 rounded-lg px-3 py-2.5"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="shrink-0 text-xs tabular-nums"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {formatSessionTime(s.startTime)}
                  </span>
                  {s.isSubagent && (
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
                      style={{
                        backgroundColor: 'rgba(99,102,241,0.12)',
                        color: '#a5b4fc',
                        border: '1px solid rgba(99,102,241,0.25)',
                      }}
                    >
                      subagent
                    </span>
                  )}
                  {s.model && (
                    <span
                      className="shrink-0 truncate rounded px-1.5 py-0.5 text-[10px]"
                      style={{
                        backgroundColor: 'var(--color-surface-raised)',
                        color: 'var(--color-text-muted)',
                        border: '1px solid var(--color-border)',
                        maxWidth: '160px',
                      }}
                    >
                      {s.model.replace(/^claude-/, '').replace(/-\d{8}$/, '')}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="flex flex-col items-end">
                    <span
                      className="text-sm font-semibold tabular-nums"
                      style={{ color: 'var(--color-text)' }}
                    >
                      {formatTokensLarge(s.outputTokens)}
                    </span>
                    <span
                      className="text-[10px] tabular-nums"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {formatTokensLarge(s.totalTokens)} total
                    </span>
                  </div>
                </div>
              </div>
              {preview !== '—' && (
                <p
                  className="truncate text-xs"
                  style={{ color: 'var(--color-text-muted)' }}
                  title={truncated ? s.firstMessage : undefined}
                >
                  {preview}
                  {truncated ? '…' : ''}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Show more / less */}
      {sessions.length > SESSION_DEFAULT_LIMIT && (
        <button
          className="mt-3 text-xs transition-opacity hover:opacity-70"
          style={{ color: 'var(--color-text-muted)' }}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? 'Show less' : `Show all ${sessions.length.toLocaleString('en-US')} sessions →`}
        </button>
      )}
    </div>
  );
};

// =============================================================================
// Main Component
// =============================================================================

export const ProjectAnalyticsPanel = ({
  projectId,
  projectName,
  projectPath,
  onBack,
}: ProjectAnalyticsPanelProps): React.JSX.Element => {
  const [summary, setSummary] = useState<ProjectAnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSummary(null);

    api.usage
      .getProjectAnalytics(projectId)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setError('No data found for this project.');
        } else {
          setSummary(result);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load analytics.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <div
      className="flex flex-1 flex-col overflow-y-auto"
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        {/* ── Back button + project header ─────────────────────────────────── */}
        <div className="mb-8">
          <button
            onClick={onBack}
            className="mb-6 flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-text"
          >
            <ArrowLeft className="size-4" />
            Back to Overview
          </button>

          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
            {projectName}
          </h1>
          <p
            className="mt-1 truncate font-mono text-xs"
            style={{ color: 'var(--color-text-muted)' }}
            title={projectPath}
          >
            {projectPath}
          </p>
        </div>

        {/* ── Loading ───────────────────────────────────────────────────────── */}
        {loading && (
          <div
            className="flex flex-1 items-center justify-center py-24"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="size-6 animate-spin" />
              <span className="text-sm">Loading analytics…</span>
            </div>
          </div>
        )}

        {/* ── Error ─────────────────────────────────────────────────────────── */}
        {!loading && error && (
          <div
            className="flex flex-1 items-center justify-center py-24"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <div className="flex flex-col items-center gap-3">
              <AlertCircle className="size-6 text-red-400" />
              <span className="text-sm">{error}</span>
            </div>
          </div>
        )}

        {/* ── Content ───────────────────────────────────────────────────────── */}
        {!loading && summary && (
          <div>
            <SummaryHeader summary={summary} />
            <ActivityChart daily={summary.daily} peakDate={summary.peakDay?.date ?? null} />
            <PeakMoments summary={summary} />
            <ByModel byModel={summary.byModel} />
            <ValueSection valueRatio={summary.valueRatio} />
            <SessionsList sessions={summary.sessions} />
          </div>
        )}
      </div>
    </div>
  );
};
