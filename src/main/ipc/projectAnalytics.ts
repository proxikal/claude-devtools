/**
 * IPC Handlers for Project Analytics.
 *
 * Handler:
 * - get-project-analytics: Deep per-project time-series data for the analytics panel.
 *
 * Strategy: Single streaming pass per JSONL file using analyzeSessionTimeSeriesData().
 * Results are cached per projectId for 5 minutes.
 */

import {
  buildProjectAnalyticsSummary,
  type ProjectDescriptor,
} from '@main/utils/analyticsAggregator';
import { analyzeSessionTimeSeriesData } from '@main/utils/jsonl';
import { createLogger } from '@shared/utils/logger';
import * as path from 'path';

import type { ServiceContextRegistry } from '../services';
import type { ProjectAnalyticsSummary } from '@shared/types/projectAnalytics';
import type { IpcMain } from 'electron';

const logger = createLogger('IPC:projectAnalytics');

// =============================================================================
// Cache (5 min TTL, keyed by projectId)
// =============================================================================

interface CacheEntry {
  summary: ProjectAnalyticsSummary;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

// =============================================================================
// Service setup
// =============================================================================

let registry: ServiceContextRegistry;

export function initializeProjectAnalyticsHandlers(contextRegistry: ServiceContextRegistry): void {
  registry = contextRegistry;
}

export function registerProjectAnalyticsHandlers(ipcMain: IpcMain): void {
  cache.clear(); // Clear stale cache on app startup
  ipcMain.handle('get-project-analytics', handleGetProjectAnalytics);
  logger.info('Project analytics handlers registered');
}

export function removeProjectAnalyticsHandlers(ipcMain: IpcMain): void {
  ipcMain.removeHandler('get-project-analytics');
}

// =============================================================================
// Handler
// =============================================================================

async function handleGetProjectAnalytics(
  _event: Electron.IpcMainInvokeEvent,
  projectId: string
): Promise<ProjectAnalyticsSummary | null> {
  if (!projectId || typeof projectId !== 'string') {
    logger.warn('get-project-analytics: missing or invalid projectId');
    return null;
  }

  const cached = cache.get(projectId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.summary;
  }

  const summary = await computeProjectAnalytics(projectId);
  if (summary) {
    cache.set(projectId, { summary, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return summary;
}

// =============================================================================
// Computation
// =============================================================================

async function computeProjectAnalytics(projectId: string): Promise<ProjectAnalyticsSummary | null> {
  const ctx = registry.getActive();
  const projectsDir = ctx.projectScanner.getProjectsDir();

  let projects: { id: string; name: string; path: string; sessions: string[] }[];
  try {
    projects = await ctx.projectScanner.scan();
  } catch (err) {
    logger.error('Failed to scan projects for analytics', err);
    return null;
  }

  const project = projects.find((p) => p.id === projectId);
  if (!project) {
    logger.warn(`Project not found: ${projectId}`);
    return null;
  }

  const descriptor: ProjectDescriptor = {
    projectId: project.id,
    projectName: project.name,
    projectPath: project.path,
  };

  const CONCURRENCY = 8;
  const sessionResults: {
    sessionId: string;
    data: Awaited<ReturnType<typeof analyzeSessionTimeSeriesData>>;
  }[] = [];

  const tasks = project.sessions.map((sessionId) => async () => {
    const filePath = path.join(projectsDir, project.id, `${sessionId}.jsonl`);
    try {
      const data = await analyzeSessionTimeSeriesData(filePath);
      if (data.totalTokens === 0 && data.outputTokens === 0) return;
      sessionResults.push({ sessionId, data });
    } catch (err) {
      logger.warn(`Failed to analyze session ${sessionId}`, err);
    }
  });

  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    await Promise.all(tasks.slice(i, i + CONCURRENCY).map((t) => t()));
  }

  const summary = buildProjectAnalyticsSummary(
    descriptor,
    sessionResults.map((r) => r.data)
  );

  // Inject session IDs into the sessions array (aggregator doesn't know them)
  for (let i = 0; i < summary.sessions.length; i++) {
    // sessions are sorted by totalTokens; find matching by tokens + startTime
    const s = summary.sessions[i];
    const match = sessionResults.find(
      (r) => r.data.startTime === s.startTime && r.data.totalTokens === s.totalTokens
    );
    if (match) summary.sessions[i] = { ...s, sessionId: match.sessionId };
  }

  return summary;
}
