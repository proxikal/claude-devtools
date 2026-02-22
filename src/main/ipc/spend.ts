/**
 * IPC Handlers for Spend/Cost Summary.
 *
 * Handler:
 * - get-spend-summary: Aggregate cost data across all projects and sessions.
 *
 * Strategy: Single streaming pass per JSONL file using analyzeSessionCostData().
 * Results are cached in memory for 2 minutes to keep repeated opens fast.
 */

import { analyzeSessionCostData } from '@main/utils/jsonl';
import { estimateCostUsd, getModelLabel } from '@shared/utils/costEstimator';
import { createLogger } from '@shared/utils/logger';
import * as path from 'path';

import type { ServiceContextRegistry } from '../services';
import type {
  DaySpend,
  ModelSpend,
  ProjectSpend,
  SessionSpend,
  SpendPeriod,
  SpendSummary,
} from '@shared/types/spend';
import type { IpcMain } from 'electron';

const logger = createLogger('IPC:spend');

// =============================================================================
// Module-level cache (2 min TTL)
// =============================================================================

interface CacheEntry {
  summary: SpendSummary;
  expiresAt: number;
}

let cachedSummary: CacheEntry | null = null;
const CACHE_TTL_MS = 2 * 60 * 1000;

// =============================================================================
// Service setup
// =============================================================================

let registry: ServiceContextRegistry;

export function initializeSpendHandlers(contextRegistry: ServiceContextRegistry): void {
  registry = contextRegistry;
}

export function registerSpendHandlers(ipcMain: IpcMain): void {
  cachedSummary = null; // Clear stale cache on each app startup
  ipcMain.handle('get-spend-summary', handleGetSpendSummary);
  logger.info('Spend handlers registered');
}

export function removeSpendHandlers(ipcMain: IpcMain): void {
  ipcMain.removeHandler('get-spend-summary');
}

// =============================================================================
// Handler
// =============================================================================

async function handleGetSpendSummary(): Promise<SpendSummary> {
  // Return cached if still fresh
  if (cachedSummary && Date.now() < cachedSummary.expiresAt) {
    return cachedSummary.summary;
  }

  const summary = await computeSpendSummary();
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
  model: string;
  costUsd: number;
  outputTokens: number;
  date: string;
  firstMessage?: string;
}

async function computeSpendSummary(): Promise<SpendSummary> {
  const ctx = registry.getActive();
  const projectsDir = ctx.projectScanner.getProjectsDir();
  let projects: { id: string; name: string; sessions: string[] }[];

  try {
    projects = await ctx.projectScanner.scan();
  } catch (err) {
    logger.error('Failed to scan projects for spend summary', err);
    return emptySpendSummary();
  }

  // Process sessions with bounded concurrency
  const raw: RawSessionCost[] = [];
  const CONCURRENCY = 8;

  for (const project of projects) {
    const tasks = project.sessions.map((sessionId) => async () => {
      const filePath = path.join(projectsDir, project.id, `${sessionId}.jsonl`);
      try {
        const costData = await analyzeSessionCostData(filePath);
        if (costData.outputTokens === 0 && costData.inputTokens === 0) return;

        const costUsd = estimateCostUsd(
          costData.inputTokens,
          costData.outputTokens,
          costData.cacheReadTokens,
          costData.cacheCreationTokens,
          costData.model
        );

        raw.push({
          sessionId,
          projectId: project.id,
          projectName: project.name,
          model: costData.model,
          costUsd,
          outputTokens: costData.outputTokens,
          date: costData.date,
          firstMessage: costData.firstMessage,
        });
      } catch (err) {
        logger.warn(`Failed to analyze cost for session ${sessionId}`, err);
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

function aggregate(raw: RawSessionCost[]): SpendSummary {
  const now = Date.now();
  const todayStr = toIsoDate(now);
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
  const day30AgoStr = toIsoDate(monthAgo);

  const emptyPeriod = (): SpendPeriod => ({ costUsd: 0, sessions: 0, outputTokens: 0 });
  const today = emptyPeriod();
  const week = emptyPeriod();
  const month = emptyPeriod();
  const allTime = emptyPeriod();

  const dayMap = new Map<string, DaySpend>();
  const projectMap = new Map<
    string,
    { name: string; costUsd: number; sessions: number; outputTokens: number }
  >();
  const modelMap = new Map<string, { label: string; costUsd: number; sessions: number }>();
  const topSessions: SessionSpend[] = [];

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
      costUsd: 0,
      sessions: 0,
      outputTokens: 0,
    };
    proj.costUsd += s.costUsd;
    proj.sessions += 1;
    proj.outputTokens += s.outputTokens;
    projectMap.set(s.projectId, proj);

    // By model
    const modelKey = s.model || 'unknown';
    const mdl = modelMap.get(modelKey) ?? {
      label: getModelLabel(s.model),
      costUsd: 0,
      sessions: 0,
    };
    mdl.costUsd += s.costUsd;
    mdl.sessions += 1;
    modelMap.set(modelKey, mdl);

    // Top sessions
    topSessions.push({
      sessionId: s.sessionId,
      projectId: s.projectId,
      projectName: s.projectName,
      costUsd: s.costUsd,
      outputTokens: s.outputTokens,
      date: dateStr,
      firstMessage: s.firstMessage,
    });
  }

  // Build daily array (ascending, last 30 days)
  const daily: DaySpend[] = Array.from(dayMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  // Build project array — sorted by output tokens, fraction relative to top project
  const maxProjectTokens = Math.max(
    ...Array.from(projectMap.values()).map((p) => p.outputTokens),
    1
  );
  const byProject: ProjectSpend[] = Array.from(projectMap.entries())
    .map(([id, p]) => ({
      projectId: id,
      projectName: p.name,
      costUsd: p.costUsd,
      sessions: p.sessions,
      outputTokens: p.outputTokens,
      fraction: p.outputTokens / maxProjectTokens,
    }))
    .sort((a, b) => b.outputTokens - a.outputTokens);

  // Build model array — sorted by output tokens, fraction of total output tokens
  const byModel: ModelSpend[] = Array.from(modelMap.entries())
    .map(([model, m]) => ({
      model,
      label: m.label,
      costUsd: m.costUsd,
      sessions: m.sessions,
      fraction: m.costUsd / (allTime.costUsd || 1),
    }))
    .sort((a, b) => b.sessions - a.sessions);

  // Top 10 sessions by output tokens
  topSessions.sort((a, b) => b.outputTokens - a.outputTokens);

  return {
    totals: { today, week, month, allTime },
    daily,
    byProject,
    byModel,
    topSessions: topSessions.slice(0, 10),
    generatedAt: Date.now(),
  };
}

function emptySpendSummary(): SpendSummary {
  const emptyPeriod = (): SpendPeriod => ({ costUsd: 0, sessions: 0, outputTokens: 0 });
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
