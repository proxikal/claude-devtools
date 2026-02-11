/**
 * SubagentLocator - Locates and manages subagent files.
 *
 * Responsibilities:
 * - Check if sessions have subagent files
 * - List subagent files for a session
 * - Handle both NEW and OLD subagent directory structures:
 *   - NEW: {projectId}/{sessionId}/subagents/agent-{agentId}.jsonl
 *   - OLD: {projectId}/agent-{agentId}.jsonl (legacy, still supported)
 * - Determine subagent ownership for OLD structure
 */

import { buildSubagentsPath, extractBaseDir } from '@main/utils/pathDecoder';
import { createLogger } from '@shared/utils/logger';
import * as fs from 'fs';
import * as path from 'path';

const logger = createLogger('Discovery:SubagentLocator');

/**
 * SubagentLocator provides methods for locating subagent files.
 */
export class SubagentLocator {
  private readonly projectsDir: string;

  constructor(projectsDir: string) {
    this.projectsDir = projectsDir;
  }

  /**
   * Checks if a session has subagent files (async).
   *
   * @param projectId - The project ID
   * @param sessionId - The session ID
   * @returns Promise resolving to true if subagents exist
   */
  async hasSubagents(projectId: string, sessionId: string): Promise<boolean> {
    return this.hasSubagentsSync(projectId, sessionId);
  }

  /**
   * Checks if a session has subagent files (session-specific only).
   * Only checks the NEW structure: {projectId}/{sessionId}/subagents/
   * Verifies that at least one subagent file has non-empty content.
   *
   * @param projectId - The project ID
   * @param sessionId - The session ID
   * @returns true if subagents exist
   */
  hasSubagentsSync(projectId: string, sessionId: string): boolean {
    // Check NEW structure: {projectId}/{sessionId}/subagents/
    const newSubagentsPath = this.getSubagentsPath(projectId, sessionId);
    if (fs.existsSync(newSubagentsPath)) {
      try {
        const entries = fs.readdirSync(newSubagentsPath);
        const subagentFiles = entries.filter(
          (name) => name.startsWith('agent-') && name.endsWith('.jsonl')
        );

        // Check if at least one subagent file has content (not empty)
        for (const fileName of subagentFiles) {
          const filePath = path.join(newSubagentsPath, fileName);
          try {
            const stats = fs.statSync(filePath);
            // File must have size > 0 and contain at least one line
            if (stats.size > 0) {
              const content = fs.readFileSync(filePath, 'utf8');
              if (content.trim().length > 0) {
                return true;
              }
            }
          } catch (error) {
            // Skip this file if we can't read it - log for debugging
            logger.debug(`SubagentLocator: Could not read file ${filePath}:`, error);
            continue;
          }
        }
      } catch {
        // Ignore errors
      }
    }

    return false;
  }

  /**
   * Lists all subagent files for a session from both NEW and OLD structures.
   * Returns NEW structure files first, then OLD structure files.
   *
   * @param projectId - The project ID
   * @param sessionId - The session ID
   * @returns Promise resolving to array of file paths
   */
  async listSubagentFiles(projectId: string, sessionId: string): Promise<string[]> {
    const allFiles: string[] = [];

    try {
      // Scan NEW structure: {projectId}/{sessionId}/subagents/agent-*.jsonl
      const newSubagentsPath = this.getSubagentsPath(projectId, sessionId);
      if (fs.existsSync(newSubagentsPath)) {
        const entries = fs.readdirSync(newSubagentsPath, { withFileTypes: true });
        const newFiles = entries
          .filter(
            (entry) =>
              entry.isFile() && entry.name.startsWith('agent-') && entry.name.endsWith('.jsonl')
          )
          .map((entry) => path.join(newSubagentsPath, entry.name));
        allFiles.push(...newFiles);
      }
    } catch (error) {
      logger.error(`Error scanning NEW subagent structure for session ${sessionId}:`, error);
    }

    try {
      // Scan OLD structure: {projectId}/agent-*.jsonl
      // Must filter by sessionId since all sessions share the same project root
      const oldFiles = await this.getProjectRootSubagentFiles(projectId, sessionId);
      allFiles.push(...oldFiles);
    } catch (error) {
      logger.error(`Error scanning OLD subagent structure for project ${projectId}:`, error);
    }

    return allFiles;
  }

  /**
   * Gets subagent files from project root (OLD structure).
   * Scans {projectId}/agent-*.jsonl files and filters by sessionId.
   *
   * In the OLD structure, all subagent files are in the project root,
   * so we must read each file's first line to check if it belongs to the session.
   *
   * @param projectId - The project ID
   * @param sessionId - The session ID
   * @returns Promise resolving to array of file paths
   */
  async getProjectRootSubagentFiles(projectId: string, sessionId: string): Promise<string[]> {
    try {
      const projectPath = path.join(this.projectsDir, extractBaseDir(projectId));

      if (!fs.existsSync(projectPath)) {
        return [];
      }

      const files = fs.readdirSync(projectPath);
      const agentFiles = files
        .filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl'))
        .map((f) => path.join(projectPath, f));

      // Filter files by checking if their sessionId matches
      const matchingFiles: string[] = [];
      for (const filePath of agentFiles) {
        if (await this.subagentBelongsToSession(filePath, sessionId)) {
          matchingFiles.push(filePath);
        }
      }

      return matchingFiles;
    } catch (error) {
      logger.error(`Error reading project root for subagent files:`, error);
      return [];
    }
  }

  /**
   * Checks if a subagent file belongs to a specific session by reading its first line.
   * Subagent files have a sessionId field that points to the parent session.
   *
   * @param filePath - Path to the subagent file
   * @param sessionId - The session ID to check
   * @returns Promise resolving to true if the subagent belongs to the session
   */
  async subagentBelongsToSession(filePath: string, sessionId: string): Promise<boolean> {
    try {
      // Read just the first line to check sessionId
      const content = fs.readFileSync(filePath, 'utf-8');
      const firstNewline = content.indexOf('\n');
      const firstLine = firstNewline > 0 ? content.slice(0, firstNewline) : content;

      if (!firstLine.trim()) {
        return false;
      }

      const entry = JSON.parse(firstLine) as { sessionId?: string };
      return entry.sessionId === sessionId;
    } catch (error) {
      // If we can't read or parse the file, don't include it - log for debugging
      logger.debug(`SubagentLocator: Could not parse file ${filePath}:`, error);
      return false;
    }
  }

  /**
   * Gets the path to the subagents directory.
   *
   * @param projectId - The project ID
   * @param sessionId - The session ID
   * @returns Path to the subagents directory
   */
  getSubagentsPath(projectId: string, sessionId: string): string {
    return buildSubagentsPath(this.projectsDir, projectId, sessionId);
  }
}
