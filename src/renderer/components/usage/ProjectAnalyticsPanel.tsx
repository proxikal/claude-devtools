/**
 * ProjectAnalyticsPanel
 *
 * Full-screen replacement for the UsageDashboard content area when a project
 * is selected. Loads ProjectAnalyticsSummary via IPC and renders all analytics
 * sections. Back button returns to the usage overview.
 *
 * Phases:
 *   Phase 2 — shell, back button, loading/error state  ← current
 *   Phase 3 — summary header + activity chart
 *   Phase 4 — model breakdown + value section
 *   Phase 5 — sessions list
 *   Phase 6 — polish
 *   Phase 7 — usage insights
 */

import { useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';

import type { ProjectAnalyticsSummary } from '@shared/types/projectAnalytics';

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
// Component
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
            className="mb-6 flex items-center gap-2 text-sm transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
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

        {/* ── Content — phases 3–7 will fill this in ───────────────────────── */}
        {!loading && summary && (
          <div className="space-y-8">
            {/* Placeholder until Phase 3 */}
            <div
              className="rounded-xl p-6 text-center text-sm"
              style={{
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-muted)',
              }}
            >
              {summary.totals.sessions} sessions ·{' '}
              {summary.totals.outputTokens.toLocaleString('en-US')} output tokens
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
