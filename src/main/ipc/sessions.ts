/**
 * IPC Handlers for Session Operations.
 *
 * Handlers:
 * - get-sessions: List sessions for a project
 * - get-sessions-paginated: List sessions with cursor-based pagination
 * - get-session-detail: Get full session detail with subagents
 * - get-session-groups: Get conversation groups for a session
 * - get-session-metrics: Get metrics for a session
 */

import { createLogger } from '@shared/utils/logger';
import { type IpcMain, type IpcMainInvokeEvent } from 'electron';

import { DataCache } from '../services';
import {
  type ConversationGroup,
  type PaginatedSessionsResult,
  type Session,
  type SessionDetail,
  type SessionMetrics,
  type SessionsPaginationOptions,
} from '../types';

import { coercePageLimit, validateProjectId, validateSessionId } from './guards';

import type { ChunkBuilder, ProjectScanner, SessionParser, SubagentResolver } from '../services';
import type { WaterfallData } from '@shared/types';

const logger = createLogger('IPC:sessions');

// Service instances - set via initialize
let projectScanner: ProjectScanner;
let sessionParser: SessionParser;
let subagentResolver: SubagentResolver;
let chunkBuilder: ChunkBuilder;
let dataCache: DataCache;

/**
 * Initializes session handlers with service instances.
 */
export function initializeSessionHandlers(
  scanner: ProjectScanner,
  parser: SessionParser,
  resolver: SubagentResolver,
  builder: ChunkBuilder,
  cache: DataCache
): void {
  projectScanner = scanner;
  sessionParser = parser;
  subagentResolver = resolver;
  chunkBuilder = builder;
  dataCache = cache;
}

/**
 * Registers all session-related IPC handlers.
 */
export function registerSessionHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('get-sessions', handleGetSessions);
  ipcMain.handle('get-sessions-paginated', handleGetSessionsPaginated);
  ipcMain.handle('get-session-detail', handleGetSessionDetail);
  ipcMain.handle('get-session-groups', handleGetSessionGroups);
  ipcMain.handle('get-session-metrics', handleGetSessionMetrics);
  ipcMain.handle('get-waterfall-data', handleGetWaterfallData);

  logger.info('Session handlers registered');
}

/**
 * Removes all session IPC handlers.
 */
export function removeSessionHandlers(ipcMain: IpcMain): void {
  ipcMain.removeHandler('get-sessions');
  ipcMain.removeHandler('get-sessions-paginated');
  ipcMain.removeHandler('get-session-detail');
  ipcMain.removeHandler('get-session-groups');
  ipcMain.removeHandler('get-session-metrics');
  ipcMain.removeHandler('get-waterfall-data');

  logger.info('Session handlers removed');
}

// =============================================================================
// Handler Implementations
// =============================================================================

/**
 * Handler for 'get-sessions' IPC call.
 * Lists all sessions for a given project.
 */
async function handleGetSessions(
  _event: IpcMainInvokeEvent,
  projectId: string
): Promise<Session[]> {
  try {
    const validatedProject = validateProjectId(projectId);
    if (!validatedProject.valid) {
      logger.error(`get-sessions rejected: ${validatedProject.error ?? 'Invalid projectId'}`);
      return [];
    }

    const sessions = await projectScanner.listSessions(validatedProject.value!);
    return sessions;
  } catch (error) {
    logger.error(`Error in get-sessions for project ${projectId}:`, error);
    return [];
  }
}

/**
 * Handler for 'get-sessions-paginated' IPC call.
 * Lists sessions for a project with cursor-based pagination.
 */
async function handleGetSessionsPaginated(
  _event: IpcMainInvokeEvent,
  projectId: string,
  cursor: string | null,
  limit?: number,
  options?: SessionsPaginationOptions
): Promise<PaginatedSessionsResult> {
  try {
    const validatedProject = validateProjectId(projectId);
    if (!validatedProject.valid) {
      logger.error(
        `get-sessions-paginated rejected: ${validatedProject.error ?? 'Invalid projectId'}`
      );
      return { sessions: [], nextCursor: null, hasMore: false, totalCount: 0 };
    }

    const safeLimit = coercePageLimit(limit, 20);
    const result = await projectScanner.listSessionsPaginated(
      validatedProject.value!,
      cursor,
      safeLimit,
      options
    );
    return result;
  } catch (error) {
    logger.error(`Error in get-sessions-paginated for project ${projectId}:`, error);
    return { sessions: [], nextCursor: null, hasMore: false, totalCount: 0 };
  }
}

/**
 * Handler for 'get-session-detail' IPC call.
 * Gets full session detail including parsed chunks and subagents.
 * Uses cache to avoid re-parsing large files.
 */
async function handleGetSessionDetail(
  _event: IpcMainInvokeEvent,
  projectId: string,
  sessionId: string
): Promise<SessionDetail | null> {
  try {
    const validatedProject = validateProjectId(projectId);
    const validatedSession = validateSessionId(sessionId);
    if (!validatedProject.valid || !validatedSession.valid) {
      logger.error(
        `get-session-detail rejected: ${validatedProject.error ?? validatedSession.error ?? 'Invalid parameters'}`
      );
      return null;
    }

    const safeProjectId = validatedProject.value!;
    const safeSessionId = validatedSession.value!;
    const cacheKey = DataCache.buildKey(safeProjectId, safeSessionId);

    // Check cache first
    let sessionDetail = dataCache.get(cacheKey);

    if (sessionDetail) {
      return sessionDetail;
    }

    // Get session metadata
    const session = await projectScanner.getSession(safeProjectId, safeSessionId);
    if (!session) {
      logger.error(`Session not found: ${sessionId}`);
      return null;
    }

    // Parse session messages
    const parsedSession = await sessionParser.parseSession(safeProjectId, safeSessionId);

    // Resolve subagents
    const subagents = await subagentResolver.resolveSubagents(
      safeProjectId,
      safeSessionId,
      parsedSession.taskCalls,
      parsedSession.messages
    );

    // Build session detail with chunks
    sessionDetail = chunkBuilder.buildSessionDetail(session, parsedSession.messages, subagents);

    // Cache the result
    dataCache.set(cacheKey, sessionDetail);

    return sessionDetail;
  } catch (error) {
    logger.error(`Error in get-session-detail for ${projectId}/${sessionId}:`, error);
    return null;
  }
}

/**
 * Handler for 'get-session-groups' IPC call.
 * Gets conversation groups for a session using the new buildGroups API.
 * This is an alternative to chunks that provides a simpler, more natural grouping.
 */
async function handleGetSessionGroups(
  _event: IpcMainInvokeEvent,
  projectId: string,
  sessionId: string
): Promise<ConversationGroup[]> {
  try {
    const validatedProject = validateProjectId(projectId);
    const validatedSession = validateSessionId(sessionId);
    if (!validatedProject.valid || !validatedSession.valid) {
      logger.error(
        `get-session-groups rejected: ${validatedProject.error ?? validatedSession.error ?? 'Invalid parameters'}`
      );
      return [];
    }
    const safeProjectId = validatedProject.value!;
    const safeSessionId = validatedSession.value!;

    // Parse session messages
    const parsedSession = await sessionParser.parseSession(safeProjectId, safeSessionId);

    // Resolve subagents
    const subagents = await subagentResolver.resolveSubagents(
      safeProjectId,
      safeSessionId,
      parsedSession.taskCalls,
      parsedSession.messages
    );

    // Build conversation groups using the new API
    const groups = chunkBuilder.buildGroups(parsedSession.messages, subagents);

    return groups;
  } catch (error) {
    logger.error(`Error in get-session-groups for ${projectId}/${sessionId}:`, error);
    return [];
  }
}

/**
 * Handler for 'get-session-metrics' IPC call.
 * Gets metrics for a session without full detail.
 */
async function handleGetSessionMetrics(
  _event: IpcMainInvokeEvent,
  projectId: string,
  sessionId: string
): Promise<SessionMetrics | null> {
  try {
    const validatedProject = validateProjectId(projectId);
    const validatedSession = validateSessionId(sessionId);
    if (!validatedProject.valid || !validatedSession.valid) {
      return null;
    }
    const safeProjectId = validatedProject.value!;
    const safeSessionId = validatedSession.value!;

    // Try to get from cache first
    const cacheKey = DataCache.buildKey(safeProjectId, safeSessionId);
    const cached = dataCache.get(cacheKey);

    if (cached) {
      return cached.metrics;
    }

    // Parse session to get metrics
    const parsedSession = await sessionParser.parseSession(safeProjectId, safeSessionId);
    return parsedSession.metrics;
  } catch (error) {
    logger.error(`Error in get-session-metrics for ${projectId}/${sessionId}:`, error);
    return null;
  }
}

/**
 * Handler for 'get-waterfall-data' IPC call.
 * Builds waterfall chart data for a session.
 */
async function handleGetWaterfallData(
  _event: IpcMainInvokeEvent,
  projectId: string,
  sessionId: string
): Promise<WaterfallData | null> {
  try {
    const detail = await handleGetSessionDetail(_event, projectId, sessionId);
    if (!detail) {
      return null;
    }

    return chunkBuilder.buildWaterfallData(detail.chunks, detail.processes);
  } catch (error) {
    logger.error(`Error in get-waterfall-data for ${projectId}/${sessionId}:`, error);
    return null;
  }
}
