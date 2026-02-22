/**
 * IPC Handlers for Usage Summary.
 *
 * Handler:
 * - get-usage-summary: Aggregate token/cost data across all projects and sessions.
 *
 * Strategy: Single streaming pass per JSONL file using analyzeSessionUsageData().
 * Results are cached in memory for 2 minutes to keep repeated opens fast.
 */

import { analyzeSessionUsageData, type SessionModelUsage } from '@main/utils/jsonl';
import { createLogger } from '@shared/utils/logger';
import { estimateCostUsd, getModelLabel } from '@shared/utils/usageEstimator';
import * as path from 'path';

import type { ServiceContextRegistry } from '../services';
import type {
  DayUsage,
  ModelUsage,
  ProjectUsage,
  SessionUsage,
  UsagePeriod,
  UsageSummary,
} from '@shared/types';
import type { IpcMain } from 'electron';

const logger = createLogger('IPC:usage');

// =============================================================================
// Module-level cache (2 min TTL)
// =============================================================================

interface CacheEntry {
  summary: UsageSummary;
  expiresAt: number;
}

let cachedSummary: CacheEntry | null = null;
const CACHE_TTL_MS = 2 * 60 * 1000;

// =============================================================================
// Service setup
// =============================================================================

let registry: ServiceContextRegistry;

export function initializeUsageHandlers(contextRegistry: ServiceContextRegistry): void {
  registry = contextRegistry;
}

export function registerUsageHandlers(ipcMain: IpcMain): void {
  cachedSummary = null; // Clear stale cache on each app startup
  ipcMain.handle('get-usage-summary', handleGetUsageSummary);
  logger.info('Usage handlers registered');
}

export function removeUsageHandlers(ipcMain: IpcMain): void {
  ipcMain.removeHandler('get-usage-summary');
}

// =============================================================================
// Handler
// =============================================================================

async function handleGetUsageSummary(): Promise<UsageSummary> {
  // Return cached if still fresh and data has totalTokens (cache bust after schema change)
  if (
    cachedSummary &&
    Date.now() < cachedSummary.expiresAt &&
    cachedSummary.summary.byProject.length > 0
  ) {
    return cachedSummary.summary;
  }

  const summary = await computeUsageSummary();
  cachedSummary = { summary, expiresAt: Date.now() + CACHE_TTL_MS };
  return summary;
}

// =============================================================================
// Computation
// =============================================================================

interface RawSessionCost {
  sessionId: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  model: string;
  modelBreakdown: Record<string, SessionModelUsage>;
  costUsd: number;
  outputTokens: number;
  totalTokens: number;
  date: string;
  firstMessage?: string;
}

async function computeUsageSummary(): Promise<UsageSummary> {
  const ctx = registry.getActive();
  const projectsDir = ctx.projectScanner.getProjectsDir();
  let projects: { id: string; name: string; path: string; sessions: string[] }[];

  try {
    projects = await ctx.projectScanner.scan();
  } catch (err) {
    logger.error('Failed to scan projects for usage summary', err);
    return emptyUsageSummary();
  }

  // Process sessions with bounded concurrency
  const raw: RawSessionCost[] = [];
  const CONCURRENCY = 8;

  for (const project of projects) {
    const tasks = project.sessions.map((sessionId) => async () => {
      const filePath = path.join(projectsDir, project.id, `${sessionId}.jsonl`);
      try {
        const usageData = await analyzeSessionUsageData(filePath);
        if (usageData.outputTokens === 0 && usageData.inputTokens === 0) return;

        const costUsd = estimateCostUsd(
          usageData.inputTokens,
          usageData.outputTokens,
          usageData.cacheReadTokens,
          usageData.cacheCreationTokens,
          usageData.model
        );

        const totalTokens =
          usageData.outputTokens +
          usageData.inputTokens +
          usageData.cacheReadTokens +
          usageData.cacheCreationTokens;

        raw.push({
          sessionId,
          projectId: project.id,
          projectName: project.name,
          projectPath: project.path,
          model: usageData.model,
          modelBreakdown: usageData.modelBreakdown,
          costUsd,
          outputTokens: usageData.outputTokens,
          totalTokens,
          date: usageData.date,
          firstMessage: usageData.firstMessage,
        });
      } catch (err) {
        logger.warn(`Failed to analyze usage for session ${sessionId}`, err);
      }
    });

    // Run tasks in batches of CONCURRENCY
    for (let i = 0; i < tasks.length; i += CONCURRENCY) {
      await Promise.all(tasks.slice(i, i + CONCURRENCY).map((t) => t()));
    }
  }

  return aggregate(raw);
}

// =============================================================================
// Aggregation
// =============================================================================

function toIsoDate(unixMs: number): string {
  return new Date(unixMs).toISOString().slice(0, 10);
}

function aggregate(raw: RawSessionCost[]): UsageSummary {
  const now = Date.now();
  const todayStr = toIsoDate(now);
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
  const day30AgoStr = toIsoDate(monthAgo);

  const emptyPeriod = (): UsagePeriod => ({ costUsd: 0, sessions: 0, outputTokens: 0 });
  const today = emptyPeriod();
  const week = emptyPeriod();
  const month = emptyPeriod();
  const allTime = emptyPeriod();

  const dayMap = new Map<string, DayUsage>();
  const projectMap = new Map<
    string,
    {
      name: string;
      projectPath: string;
      costUsd: number;
      sessions: number;
      outputTokens: number;
      totalTokens: number;
    }
  >();
  const modelMap = new Map<
    string,
    { label: string; costUsd: number; sessions: number; outputTokens: number }
  >();
  const topSessions: SessionUsage[] = [];

  for (const s of raw) {
    const dateStr = s.date || todayStr;
    const dateMs = new Date(dateStr).getTime();

    // Totals
    allTime.costUsd += s.costUsd;
    allTime.sessions += 1;
    allTime.outputTokens += s.outputTokens;

    if (dateMs >= weekAgo) {
      week.costUsd += s.costUsd;
      week.sessions += 1;
      week.outputTokens += s.outputTokens;
    }
    if (dateMs >= monthAgo) {
      month.costUsd += s.costUsd;
      month.sessions += 1;
      month.outputTokens += s.outputTokens;
    }
    if (dateStr === todayStr) {
      today.costUsd += s.costUsd;
      today.sessions += 1;
      today.outputTokens += s.outputTokens;
    }

    // Daily (last 30 days)
    if (dateStr >= day30AgoStr) {
      const existing = dayMap.get(dateStr) ?? {
        date: dateStr,
        costUsd: 0,
        sessions: 0,
        outputTokens: 0,
      };
      existing.costUsd += s.costUsd;
      existing.sessions += 1;
      existing.outputTokens += s.outputTokens;
      dayMap.set(dateStr, existing);
    }

    // By project
    const proj = projectMap.get(s.projectId) ?? {
      name: s.projectName,
      projectPath: s.projectPath,
      costUsd: 0,
      sessions: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
    proj.costUsd += s.costUsd;
    proj.sessions += 1;
    proj.outputTokens += s.outputTokens;
    proj.totalTokens += s.totalTokens;
    projectMap.set(s.projectId, proj);

    // By model — use per-model breakdown for accurate attribution
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

    // Top sessions
    topSessions.push({
      sessionId: s.sessionId,
      projectId: s.projectId,
      projectName: s.projectName,
      costUsd: s.costUsd,
      outputTokens: s.outputTokens,
      totalTokens: s.totalTokens,
      date: dateStr,
      firstMessage: s.firstMessage,
    });
  }

  // Build daily array (ascending, last 30 days)
  const daily: DayUsage[] = Array.from(dayMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  // Build project array — sorted by total tokens, each fraction independently normalized
  const maxProjectTokens = Math.max(
    ...Array.from(projectMap.values()).map((p) => p.totalTokens),
    1
  );
  const maxOutputTokens = Math.max(
    ...Array.from(projectMap.values()).map((p) => p.outputTokens),
    1
  );

  // Detect name collisions and disambiguate with parent folder
  const nameCounts = new Map<string, number>();
  for (const p of projectMap.values()) {
    nameCounts.set(p.name, (nameCounts.get(p.name) ?? 0) + 1);
  }

  const byProject: ProjectUsage[] = Array.from(projectMap.entries())
    .map(([id, p]) => {
      let displayName = p.name;
      if ((nameCounts.get(p.name) ?? 0) > 1) {
        const parentSegment = path.basename(path.dirname(p.projectPath));
        if (parentSegment && parentSegment !== '.') {
          displayName = `${p.name} · ${parentSegment}`;
        }
      }
      return {
        projectId: id,
        projectName: displayName,
        projectPath: p.projectPath,
        costUsd: p.costUsd,
        sessions: p.sessions,
        outputTokens: p.outputTokens,
        totalTokens: p.totalTokens,
        outputFraction: p.outputTokens / maxOutputTokens,
        fraction: p.totalTokens / maxProjectTokens,
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);

  // Build model array — sorted by output tokens, fraction of total output tokens
  const maxModelTokens = Math.max(...Array.from(modelMap.values()).map((m) => m.outputTokens), 1);
  const byModel: ModelUsage[] = Array.from(modelMap.entries())
    .map(([model, m]) => ({
      model,
      label: m.label,
      costUsd: m.costUsd,
      sessions: m.sessions,
      outputTokens: m.outputTokens,
      fraction: m.outputTokens / maxModelTokens,
    }))
    .sort((a, b) => b.outputTokens - a.outputTokens);

  // Top sessions by total tokens (reflects true heaviness)
  topSessions.sort((a, b) => b.totalTokens - a.totalTokens);

  return {
    totals: { today, week, month, allTime },
    daily,
    byProject,
    byModel,
    topSessions: topSessions.slice(0, 25),
    generatedAt: Date.now(),
  };
}

function emptyUsageSummary(): UsageSummary {
  const emptyPeriod = (): UsagePeriod => ({ costUsd: 0, sessions: 0, outputTokens: 0 });
  return {
    totals: {
      today: emptyPeriod(),
      week: emptyPeriod(),
      month: emptyPeriod(),
      allTime: emptyPeriod(),
    },
    daily: [],
    byProject: [],
    byModel: [],
    topSessions: [],
    generatedAt: Date.now(),
  };
}
