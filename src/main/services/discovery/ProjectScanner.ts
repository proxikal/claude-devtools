/**
 * ProjectScanner service - Scans ~/.claude/projects/ directory and lists all projects.
 *
 * Responsibilities:
 * - Read project directories from ~/.claude/projects/
 * - Decode directory names to original paths (with cwd fallback)
 * - List session files for each project
 * - Read task list data from ~/.claude/todos/
 * - Return sorted list of projects by recent activity
 *
 * Delegates to specialized services:
 * - SessionContentFilter: Noise detection and message filtering
 * - WorktreeGrouper: Git repository grouping
 * - SubagentLocator: Subagent file lookup
 * - SessionSearcher: Search functionality
 */

import {
  type PaginatedSessionsResult,
  type Project,
  type RepositoryGroup,
  type SearchSessionsResult,
  type Session,
  type SessionCursor,
  type SessionsPaginationOptions,
} from '@main/types';
import { analyzeSessionFileMetadata, extractCwd } from '@main/utils/jsonl';
import {
  buildSessionPath,
  buildSubagentsPath,
  buildTodoPath,
  extractBaseDir,
  extractProjectName,
  extractSessionId,
  getProjectsBasePath,
  getTodosBasePath,
  isValidEncodedPath,
} from '@main/utils/pathDecoder';
import { createLogger } from '@shared/utils/logger';
import * as fs from 'fs';
import * as path from 'path';

import { SessionContentFilter } from './SessionContentFilter';
import { subprojectRegistry } from './SubprojectRegistry';

const logger = createLogger('Discovery:ProjectScanner');
import { ProjectPathResolver } from './ProjectPathResolver';
import { SessionSearcher } from './SessionSearcher';
import { SubagentLocator } from './SubagentLocator';
import { WorktreeGrouper } from './WorktreeGrouper';

export class ProjectScanner {
  private readonly projectsDir: string;
  private readonly todosDir: string;
  private readonly contentPresenceCache = new Map<
    string,
    { mtimeMs: number; hasContent: boolean }
  >();
  private readonly sessionMetadataCache = new Map<
    string,
    {
      mtimeMs: number;
      metadata: Awaited<ReturnType<typeof analyzeSessionFileMetadata>>;
    }
  >();

  // Delegated services
  private readonly sessionContentFilter: typeof SessionContentFilter;
  private readonly worktreeGrouper: WorktreeGrouper;
  private readonly subagentLocator: SubagentLocator;
  private readonly sessionSearcher: SessionSearcher;
  private readonly projectPathResolver: ProjectPathResolver;

  constructor(projectsDir?: string, todosDir?: string) {
    this.projectsDir = projectsDir ?? getProjectsBasePath();
    this.todosDir = todosDir ?? getTodosBasePath();

    // Initialize delegated services
    this.sessionContentFilter = SessionContentFilter;
    this.worktreeGrouper = new WorktreeGrouper(this.projectsDir);
    this.subagentLocator = new SubagentLocator(this.projectsDir);
    this.sessionSearcher = new SessionSearcher(this.projectsDir);
    this.projectPathResolver = new ProjectPathResolver(this.projectsDir);
  }

  // ===========================================================================
  // Project Scanning
  // ===========================================================================

  /**
   * Scans the projects directory and returns a list of all projects.
   * @returns Promise resolving to projects sorted by most recent activity
   */
  async scan(): Promise<Project[]> {
    try {
      if (!fs.existsSync(this.projectsDir)) {
        logger.warn(`Projects directory does not exist: ${this.projectsDir}`);
        return [];
      }

      // Clear the subproject registry on full re-scan
      subprojectRegistry.clear();

      const entries = fs.readdirSync(this.projectsDir, { withFileTypes: true });

      // Filter to only directories with valid encoding pattern
      const projectDirs = entries.filter(
        (entry) => entry.isDirectory() && isValidEncodedPath(entry.name)
      );

      // Process each project directory (may return multiple projects per dir)
      const projectArrays = await Promise.all(projectDirs.map((dir) => this.scanProject(dir.name)));

      // Flatten and sort by most recent
      const validProjects = projectArrays.flat();
      validProjects.sort((a, b) => (b.mostRecentSession ?? 0) - (a.mostRecentSession ?? 0));

      return validProjects;
    } catch (error) {
      logger.error('Error scanning projects directory:', error);
      return [];
    }
  }

  // ===========================================================================
  // Repository Grouping (Worktree Support)
  // ===========================================================================

  /**
   * Scans projects and groups them by git repository.
   * Projects belonging to the same git repository (main repo + worktrees)
   * are grouped together under a single RepositoryGroup.
   * Non-git projects are represented as single-worktree groups.
   *
   * Sessions are filtered to exclude noise-only sessions, so counts
   * accurately reflect visible sessions in the UI.
   *
   * @returns Promise resolving to RepositoryGroups sorted by most recent activity
   */
  async scanWithWorktreeGrouping(): Promise<RepositoryGroup[]> {
    try {
      // 1. Scan all projects using existing logic
      const projects = await this.scan();

      if (projects.length === 0) {
        return [];
      }

      // 2. Delegate to WorktreeGrouper
      return this.worktreeGrouper.groupByRepository(projects);
    } catch (error) {
      logger.error('Error scanning with worktree grouping:', error);
      return [];
    }
  }

  /**
   * Lists sessions for a specific worktree within a repository group.
   * This is a convenience method that delegates to listSessions since
   * worktree.id is the same as project.id.
   *
   * @param worktreeId - The worktree ID (same as project ID)
   */
  async listWorktreeSessions(worktreeId: string): Promise<Session[]> {
    return this.listSessions(worktreeId);
  }

  // ===========================================================================
  // Project Scanning (continued)
  // ===========================================================================

  /**
   * Scans a single project directory and returns project metadata.
   * If sessions have different cwd values, splits into multiple projects.
   */
  private async scanProject(encodedName: string): Promise<Project[]> {
    try {
      const projectPath = path.join(this.projectsDir, encodedName);
      const entries = fs.readdirSync(projectPath, { withFileTypes: true });

      // Get session files (.jsonl at root level)
      const sessionFiles = entries.filter(
        (entry) => entry.isFile() && entry.name.endsWith('.jsonl')
      );

      if (sessionFiles.length === 0) {
        return [];
      }

      // Collect file stats and cwd for each session
      interface SessionInfo {
        sessionId: string;
        filePath: string;
        mtimeMs: number;
        birthtimeMs: number;
        cwd: string | null;
      }

      const sessionInfos: SessionInfo[] = await Promise.all(
        sessionFiles.map(async (file) => {
          const filePath = path.join(projectPath, file.name);
          const stats = fs.statSync(filePath);
          let cwd: string | null = null;
          try {
            cwd = await extractCwd(filePath);
          } catch {
            // Ignore unreadable files
          }
          return {
            sessionId: extractSessionId(file.name),
            filePath,
            mtimeMs: stats.mtimeMs,
            birthtimeMs: stats.birthtimeMs,
            cwd,
          };
        })
      );

      // Group sessions by cwd
      const cwdGroups = new Map<string, SessionInfo[]>();
      const baseName = extractProjectName(encodedName);
      const decodedFallback = baseName; // Used when cwd is null

      for (const info of sessionInfos) {
        const key = info.cwd ?? `__decoded__${decodedFallback}`;
        const group = cwdGroups.get(key) ?? [];
        group.push(info);
        cwdGroups.set(key, group);
      }

      // If only 1 unique cwd, return single project (current behavior)
      if (cwdGroups.size <= 1) {
        const allSessionIds = sessionInfos.map((s) => s.sessionId);
        let mostRecentSession: number | undefined;
        let createdAt = Date.now();
        for (const info of sessionInfos) {
          if (!mostRecentSession || info.mtimeMs > mostRecentSession) {
            mostRecentSession = info.mtimeMs;
          }
          if (info.birthtimeMs < createdAt) {
            createdAt = info.birthtimeMs;
          }
        }

        const sessionPaths = sessionInfos.map((s) => s.filePath);
        const actualPath = await this.projectPathResolver.resolveProjectPath(encodedName, {
          sessionPaths,
        });

        return [
          {
            id: encodedName,
            path: actualPath,
            name: baseName,
            sessions: allSessionIds,
            createdAt: Math.floor(createdAt),
            mostRecentSession: mostRecentSession ? Math.floor(mostRecentSession) : undefined,
          },
        ];
      }

      // Multiple unique cwds: split into subprojects
      const projects: Project[] = [];

      // Find the "root" cwd (shortest path, or the one matching the decoded name)
      const cwdKeys = [...cwdGroups.keys()].filter((k) => !k.startsWith('__decoded__'));
      const rootCwd = cwdKeys.reduce(
        (shortest, cwd) => (cwd.length <= shortest.length ? cwd : shortest),
        cwdKeys[0] ?? ''
      );

      for (const [cwdKey, sessions] of cwdGroups) {
        const isDecodedFallback = cwdKey.startsWith('__decoded__');
        const actualCwd = isDecodedFallback ? null : cwdKey;

        // Register in subproject registry
        const sessionIds = sessions.map((s) => s.sessionId);
        const compositeId = subprojectRegistry.register(
          encodedName,
          actualCwd ?? decodedFallback,
          sessionIds
        );

        // Compute timestamps
        let mostRecentSession: number | undefined;
        let createdAt = Date.now();
        for (const info of sessions) {
          if (!mostRecentSession || info.mtimeMs > mostRecentSession) {
            mostRecentSession = info.mtimeMs;
          }
          if (info.birthtimeMs < createdAt) {
            createdAt = info.birthtimeMs;
          }
        }

        // Build display name
        let displayName: string;
        if (!actualCwd || actualCwd === rootCwd) {
          displayName = baseName;
        } else {
          // Use last segment of cwd for disambiguation
          const lastSegment = path.basename(actualCwd);
          displayName = `${baseName} (${lastSegment})`;
        }

        projects.push({
          id: compositeId,
          path: actualCwd ?? decodedFallback,
          name: displayName,
          sessions: sessionIds,
          createdAt: Math.floor(createdAt),
          mostRecentSession: mostRecentSession ? Math.floor(mostRecentSession) : undefined,
        });
      }

      return projects;
    } catch (error) {
      logger.error(`Error scanning project ${encodedName}:`, error);
      return [];
    }
  }

  /**
   * Gets details for a specific project by ID.
   * Handles composite IDs by scanning the base directory and finding the matching subproject.
   */
  async getProject(projectId: string): Promise<Project | null> {
    const baseDir = extractBaseDir(projectId);
    const projectPath = path.join(this.projectsDir, baseDir);

    if (!fs.existsSync(projectPath)) {
      return null;
    }

    // For composite IDs, scan and find the matching subproject
    if (subprojectRegistry.isComposite(projectId)) {
      const projects = await this.scanProject(baseDir);
      return projects.find((p) => p.id === projectId) ?? null;
    }

    const projects = await this.scanProject(baseDir);
    return projects.find((p) => p.id === projectId) ?? projects[0] ?? null;
  }

  // ===========================================================================
  // Session Listing
  // ===========================================================================

  /**
   * Lists all sessions for a given project with metadata.
   * Filters out sessions that contain only noise messages.
   */
  async listSessions(projectId: string): Promise<Session[]> {
    try {
      const baseDir = extractBaseDir(projectId);
      const projectPath = path.join(this.projectsDir, baseDir);
      const sessionFilter = subprojectRegistry.getSessionFilter(projectId);

      if (!fs.existsSync(projectPath)) {
        return [];
      }

      const entries = fs.readdirSync(projectPath, { withFileTypes: true });
      let sessionFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'));

      // Filter to only sessions belonging to this subproject
      if (sessionFilter) {
        sessionFiles = sessionFiles.filter((f) => sessionFilter.has(extractSessionId(f.name)));
      }

      const sessionPaths = sessionFiles.map((file) => path.join(projectPath, file.name));
      const decodedPath = await this.resolveProjectPathForId(projectId, sessionPaths);

      const sessions = await Promise.all(
        sessionFiles.map(async (file) => {
          const sessionId = extractSessionId(file.name);
          const filePath = path.join(projectPath, file.name);

          // Check if session has non-noise messages (delegated to SessionContentFilter)
          const hasContent = await this.hasDisplayableContent(filePath);
          if (!hasContent) {
            return null; // Filter out noise-only sessions
          }

          return this.buildSessionMetadata(projectId, sessionId, filePath, decodedPath);
        })
      );

      // Filter out null results (noise-only sessions)
      const validSessions = sessions.filter((s): s is Session => s !== null);

      // Sort by created date (most recent first)
      validSessions.sort((a, b) => b.createdAt - a.createdAt);

      return validSessions;
    } catch (error) {
      logger.error(`Error listing sessions for project ${projectId}:`, error);
      return [];
    }
  }

  /**
   * Lists sessions for a project with cursor-based pagination.
   * Efficiently fetches only the sessions needed for the current page.
   *
   * @param projectId - The project ID to list sessions for
   * @param cursor - Base64-encoded cursor from previous page (null for first page)
   * @param limit - Number of sessions to return (default 20)
   * @returns Paginated result with sessions, cursor, and metadata
   */
  async listSessionsPaginated(
    projectId: string,
    cursor: string | null,
    limit: number = 20,
    options?: SessionsPaginationOptions
  ): Promise<PaginatedSessionsResult> {
    try {
      const includeTotalCount = options?.includeTotalCount ?? false;
      const prefilterAll = options?.prefilterAll ?? false;
      const baseDir = extractBaseDir(projectId);
      const projectPath = path.join(this.projectsDir, baseDir);
      const sessionFilter = subprojectRegistry.getSessionFilter(projectId);

      if (!fs.existsSync(projectPath)) {
        return { sessions: [], nextCursor: null, hasMore: false, totalCount: 0 };
      }

      // Step 1: Get all session files with their timestamps (lightweight stat calls)
      const entries = fs.readdirSync(projectPath, { withFileTypes: true });
      let sessionFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'));

      // Filter to only sessions belonging to this subproject
      if (sessionFilter) {
        sessionFiles = sessionFiles.filter((f) => sessionFilter.has(extractSessionId(f.name)));
      }

      // Get stats for all session files
      interface SessionFileInfo {
        name: string;
        sessionId: string;
        timestamp: number;
        filePath: string;
        mtimeMs: number;
      }
      const fileInfos: SessionFileInfo[] = [];

      for (const file of sessionFiles) {
        const filePath = path.join(projectPath, file.name);
        try {
          const stats = fs.statSync(filePath);
          fileInfos.push({
            name: file.name,
            sessionId: extractSessionId(file.name),
            timestamp: stats.mtimeMs,
            filePath,
            mtimeMs: stats.mtimeMs,
          });
        } catch {
          // Skip files we can't stat
          continue;
        }
      }

      // Step 2: Sort by timestamp descending (most recent first)
      fileInfos.sort((a, b) => {
        if (b.timestamp !== a.timestamp) {
          return b.timestamp - a.timestamp;
        }
        // Tie-breaker: sort by sessionId alphabetically
        return a.sessionId.localeCompare(b.sessionId);
      });

      // Step 3: Optionally pre-filter all sessions for accurate total count
      // This is slower but provides exact totalCount.
      let validSessionIds: Set<string> | null = null;
      let totalCount = 0;
      if (prefilterAll) {
        validSessionIds = new Set<string>();
        for (const fileInfo of fileInfos) {
          if (await this.hasDisplayableContent(fileInfo.filePath, fileInfo.mtimeMs)) {
            validSessionIds.add(fileInfo.sessionId);
          }
        }
        totalCount = validSessionIds.size;
      }

      // Step 4: Apply cursor filter to find starting position
      let startIndex = 0;
      if (cursor) {
        try {
          const decoded = JSON.parse(
            Buffer.from(cursor, 'base64').toString('utf8')
          ) as SessionCursor;
          startIndex = fileInfos.findIndex((info) => {
            // Find the first item that comes AFTER the cursor
            if (info.timestamp < decoded.timestamp) return true;
            if (info.timestamp === decoded.timestamp && info.sessionId > decoded.sessionId)
              return true;
            return false;
          });
          // If cursor not found, start from beginning
          if (startIndex === -1) startIndex = fileInfos.length;
        } catch {
          // Invalid cursor, start from beginning
          startIndex = 0;
        }
      }

      // Step 5: Fetch sessions for this page
      const decodedPath = await this.resolveProjectPathForId(
        projectId,
        fileInfos.map((fileInfo) => fileInfo.filePath)
      );
      const sessions: Session[] = [];
      let scannedCandidates = 0;

      // Fast path: avoid pre-filtering everything. Scan until we have enough page items.
      for (let i = startIndex; i < fileInfos.length; i++) {
        const fileInfo = fileInfos[i];
        if (!fileInfo) {
          continue;
        }
        scannedCandidates++;

        let hasContent: boolean;
        if (validSessionIds) {
          hasContent = validSessionIds.has(fileInfo.sessionId);
        } else {
          hasContent = await this.hasDisplayableContent(fileInfo.filePath, fileInfo.mtimeMs);
        }
        if (!hasContent) {
          continue;
        }

        const session = await this.buildSessionMetadata(
          projectId,
          fileInfo.sessionId,
          fileInfo.filePath,
          decodedPath
        );
        sessions.push(session);

        if (sessions.length >= limit + 1) {
          break;
        }
      }

      // Step 6: Build next cursor
      let nextCursor: string | null = null;
      const hasMore = sessions.length > limit || startIndex + scannedCandidates < fileInfos.length;

      const pageSessions = hasMore ? sessions.slice(0, limit) : sessions;

      // If total count wasn't precomputed, keep UI-safe lower bound
      if (!includeTotalCount) {
        // Lightweight mode: return a lower-bound count to avoid full scans.
        totalCount = pageSessions.length + (hasMore ? 1 : 0);
      }

      if (pageSessions.length > 0 && hasMore) {
        const lastSession = pageSessions[pageSessions.length - 1];
        const lastFileInfo = fileInfos.find((f) => f.sessionId === lastSession.id);
        if (lastFileInfo) {
          const cursorData: SessionCursor = {
            timestamp: lastFileInfo.timestamp,
            sessionId: lastFileInfo.sessionId,
          };
          nextCursor = Buffer.from(JSON.stringify(cursorData)).toString('base64');
        }
      }

      return {
        sessions: pageSessions,
        nextCursor,
        hasMore: nextCursor !== null,
        totalCount,
      };
    } catch (error) {
      logger.error(`Error listing paginated sessions for project ${projectId}:`, error);
      return { sessions: [], nextCursor: null, hasMore: false, totalCount: 0 };
    }
  }

  /**
   * Build session metadata from a session file.
   */
  private async buildSessionMetadata(
    projectId: string,
    sessionId: string,
    filePath: string,
    projectPath: string
  ): Promise<Session> {
    const stats = fs.statSync(filePath);
    const cachedMetadata = this.sessionMetadataCache.get(filePath);
    const metadata =
      cachedMetadata?.mtimeMs === stats.mtimeMs
        ? cachedMetadata.metadata
        : await analyzeSessionFileMetadata(filePath);
    if (cachedMetadata?.mtimeMs !== stats.mtimeMs) {
      this.sessionMetadataCache.set(filePath, { mtimeMs: stats.mtimeMs, metadata });
    }

    // Check for subagents (delegated to SubagentLocator)
    const hasSubagents = this.subagentLocator.hasSubagentsSync(projectId, sessionId);

    // Load task list data if exists
    const todoData = await this.loadTodoData(sessionId);

    return {
      id: sessionId,
      projectId,
      projectPath,
      todoData,
      createdAt: Math.floor(stats.birthtimeMs),
      firstMessage: metadata.firstUserMessage?.text,
      messageTimestamp: metadata.firstUserMessage?.timestamp,
      hasSubagents,
      messageCount: metadata.messageCount,
      isOngoing: metadata.isOngoing,
      gitBranch: metadata.gitBranch ?? undefined,
    };
  }

  /**
   * Gets a single session's metadata.
   */
  async getSession(projectId: string, sessionId: string): Promise<Session | null> {
    const filePath = this.getSessionPath(projectId, sessionId);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const decodedPath = await this.resolveProjectPathForId(projectId);
    return this.buildSessionMetadata(projectId, sessionId, filePath, decodedPath);
  }

  // ===========================================================================
  // Task List Data
  // ===========================================================================

  /**
   * Loads task list data for a session from ~/.claude/todos/{sessionId}.json
   */
  async loadTodoData(sessionId: string): Promise<unknown> {
    try {
      const todoPath = buildTodoPath(path.dirname(this.projectsDir), sessionId);

      if (!fs.existsSync(todoPath)) {
        return undefined;
      }

      const content = fs.readFileSync(todoPath, 'utf8');
      return JSON.parse(content) as unknown;
    } catch (error) {
      // Log but continue - task list data is non-critical
      logger.debug(`Failed to load task list data for session ${sessionId}:`, error);
      return undefined;
    }
  }

  // ===========================================================================
  // Path Helpers
  // ===========================================================================

  /**
   * Gets the path to the session JSONL file.
   */
  getSessionPath(projectId: string, sessionId: string): string {
    return buildSessionPath(this.projectsDir, projectId, sessionId);
  }

  /**
   * Gets the path to the subagents directory.
   */
  getSubagentsPath(projectId: string, sessionId: string): string {
    return buildSubagentsPath(this.projectsDir, projectId, sessionId);
  }

  /**
   * Lists all session file paths for a project.
   */
  async listSessionFiles(projectId: string): Promise<string[]> {
    try {
      const baseDir = extractBaseDir(projectId);
      const projectPath = path.join(this.projectsDir, baseDir);
      const sessionFilter = subprojectRegistry.getSessionFilter(projectId);

      if (!fs.existsSync(projectPath)) {
        return [];
      }

      const entries = fs.readdirSync(projectPath, { withFileTypes: true });

      let files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'));

      if (sessionFilter) {
        files = files.filter((entry) => sessionFilter.has(extractSessionId(entry.name)));
      }

      return files.map((entry) => path.join(projectPath, entry.name));
    } catch (error) {
      logger.error(`Error listing session files for project ${projectId}:`, error);
      return [];
    }
  }

  // ===========================================================================
  // Subagent Detection (delegated to SubagentLocator)
  // ===========================================================================

  /**
   * Checks if a session has a subagents directory (async).
   */
  async hasSubagents(projectId: string, sessionId: string): Promise<boolean> {
    return this.subagentLocator.hasSubagents(projectId, sessionId);
  }

  /**
   * Checks if a session has subagent files (session-specific only).
   * Only checks the NEW structure: {projectId}/{sessionId}/subagents/
   * Verifies that at least one subagent file has non-empty content.
   */
  hasSubagentsSync(projectId: string, sessionId: string): boolean {
    return this.subagentLocator.hasSubagentsSync(projectId, sessionId);
  }

  /**
   * Lists all subagent files for a session from both NEW and OLD structures.
   * Returns NEW structure files first, then OLD structure files.
   */
  async listSubagentFiles(projectId: string, sessionId: string): Promise<string[]> {
    return this.subagentLocator.listSubagentFiles(projectId, sessionId);
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Gets the base projects directory path.
   */
  getProjectsDir(): string {
    return this.projectsDir;
  }

  /**
   * Gets the base todos directory path.
   */
  getTodosDir(): string {
    return this.todosDir;
  }

  /**
   * Checks if the projects directory exists.
   */
  projectsDirExists(): boolean {
    return fs.existsSync(this.projectsDir);
  }

  // ===========================================================================
  // Search (delegated to SessionSearcher)
  // ===========================================================================

  /**
   * Searches sessions in a project for a query string.
   * Filters out noise messages and returns matching content.
   *
   * @param projectId - The project ID to search in
   * @param query - Search query string
   * @param maxResults - Maximum number of results to return (default 50)
   */
  async searchSessions(
    projectId: string,
    query: string,
    maxResults: number = 50
  ): Promise<SearchSessionsResult> {
    return this.sessionSearcher.searchSessions(projectId, query, maxResults);
  }

  /**
   * Resolves the project path for a given project ID.
   * For composite IDs, uses the registry's cwd directly.
   * For plain IDs, delegates to ProjectPathResolver.
   */
  private async resolveProjectPathForId(
    projectId: string,
    sessionPaths?: string[]
  ): Promise<string> {
    const registryCwd = subprojectRegistry.getCwd(projectId);
    if (registryCwd) {
      return registryCwd;
    }
    const baseDir = extractBaseDir(projectId);
    return this.projectPathResolver.resolveProjectPath(baseDir, {
      sessionPaths,
    });
  }

  /**
   * Checks whether a session file has non-noise displayable content.
   * Uses mtime-based memoization to avoid expensive re-parsing on repeated requests.
   */
  private async hasDisplayableContent(filePath: string, mtimeMs?: number): Promise<boolean> {
    try {
      const effectiveMtime = mtimeMs ?? fs.statSync(filePath).mtimeMs;
      const cached = this.contentPresenceCache.get(filePath);
      if (cached?.mtimeMs === effectiveMtime) {
        return cached.hasContent;
      }

      const hasContent = await this.sessionContentFilter.hasNonNoiseMessages(filePath);
      this.contentPresenceCache.set(filePath, { mtimeMs: effectiveMtime, hasContent });
      return hasContent;
    } catch {
      return false;
    }
  }
}
