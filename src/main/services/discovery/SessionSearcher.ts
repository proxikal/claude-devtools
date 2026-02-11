/**
 * SessionSearcher - Searches sessions for query strings.
 *
 * Responsibilities:
 * - Search across sessions in a project
 * - Search within a single session file
 * - Restrict matching scope to User text + AI last text output
 * - Extract context around each match occurrence
 */

import { ChunkBuilder } from '@main/services/analysis/ChunkBuilder';
import {
  isEnhancedAIChunk,
  isUserChunk,
  type ParsedMessage,
  type SearchResult,
  type SearchSessionsResult,
  type SemanticStep,
} from '@main/types';
import { parseJsonlFile } from '@main/utils/jsonl';
import { extractBaseDir, extractSessionId } from '@main/utils/pathDecoder';
import { sanitizeDisplayContent } from '@shared/utils/contentSanitizer';
import { createLogger } from '@shared/utils/logger';
import {
  extractMarkdownPlainText,
  findMarkdownSearchMatches,
} from '@shared/utils/markdownTextSearch';
import * as fs from 'fs';
import * as path from 'path';

import { subprojectRegistry } from './SubprojectRegistry';

const logger = createLogger('Discovery:SessionSearcher');

interface SearchableEntry {
  text: string;
  groupId: string;
  messageType: 'user' | 'assistant';
  itemType: 'user' | 'ai';
  timestamp: number;
  messageUuid: string;
}

/**
 * SessionSearcher provides methods for searching sessions.
 */
export class SessionSearcher {
  private readonly projectsDir: string;
  private readonly chunkBuilder: ChunkBuilder;

  constructor(projectsDir: string) {
    this.projectsDir = projectsDir;
    this.chunkBuilder = new ChunkBuilder();
  }

  /**
   * Searches sessions in a project for a query string.
   * Filters out noise messages and returns matching content.
   *
   * @param projectId - The project ID to search in
   * @param query - Search query string
   * @param maxResults - Maximum number of results to return (default 50)
   * @returns Search results with matches and metadata
   */
  async searchSessions(
    projectId: string,
    query: string,
    maxResults: number = 50
  ): Promise<SearchSessionsResult> {
    const results: SearchResult[] = [];
    let sessionsSearched = 0;

    if (!query || query.trim().length === 0) {
      return { results: [], totalMatches: 0, sessionsSearched: 0, query };
    }

    const normalizedQuery = query.toLowerCase().trim();

    try {
      const baseDir = extractBaseDir(projectId);
      const projectPath = path.join(this.projectsDir, baseDir);
      const sessionFilter = subprojectRegistry.getSessionFilter(projectId);

      try {
        await fs.promises.access(projectPath, fs.constants.R_OK);
      } catch {
        return { results: [], totalMatches: 0, sessionsSearched: 0, query };
      }

      // Get all session files
      const entries = await fs.promises.readdir(projectPath, { withFileTypes: true });
      const sessionFilesWithTime = await Promise.all(
        entries
          .filter((entry) => {
            if (!entry.isFile() || !entry.name.endsWith('.jsonl')) return false;
            // Filter to only sessions belonging to this subproject
            if (sessionFilter) {
              const sessionId = extractSessionId(entry.name);
              return sessionFilter.has(sessionId);
            }
            return true;
          })
          .map(async (entry) => {
            const filePath = path.join(projectPath, entry.name);
            try {
              const stats = await fs.promises.stat(filePath);
              return { name: entry.name, filePath, mtimeMs: stats.mtimeMs };
            } catch {
              return null;
            }
          })
      );
      const sessionFiles = sessionFilesWithTime
        .filter((entry): entry is { name: string; filePath: string; mtimeMs: number } => !!entry)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

      // Search each session file
      for (const file of sessionFiles) {
        if (results.length >= maxResults) break;

        const sessionId = extractSessionId(file.name);
        const filePath = file.filePath;
        sessionsSearched++;

        try {
          const sessionResults = await this.searchSessionFile(
            projectId,
            sessionId,
            filePath,
            normalizedQuery,
            maxResults - results.length
          );
          results.push(...sessionResults);
        } catch {
          // Skip files we can't read
          continue;
        }
      }

      return {
        results,
        totalMatches: results.length,
        sessionsSearched,
        query,
      };
    } catch (error) {
      logger.error(`Error searching sessions for project ${projectId}:`, error);
      return { results: [], totalMatches: 0, sessionsSearched: 0, query };
    }
  }

  /**
   * Searches a single session file for a query string.
   *
   * @param projectId - The project ID
   * @param sessionId - The session ID
   * @param filePath - Path to the session file
   * @param query - Normalized search query (lowercase)
   * @param maxResults - Maximum number of results to return
   * @returns Array of search results
   */
  async searchSessionFile(
    projectId: string,
    sessionId: string,
    filePath: string,
    query: string,
    maxResults: number
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    let sessionTitle: string | undefined;
    const messages = await parseJsonlFile(filePath);
    const chunks = this.chunkBuilder.buildChunks(messages, []);

    for (const chunk of chunks) {
      if (results.length >= maxResults) {
        break;
      }

      if (isUserChunk(chunk)) {
        const userText = this.extractUserSearchableText(chunk.userMessage);
        if (!sessionTitle && userText) {
          sessionTitle = userText.slice(0, 100);
        }
        if (!userText) {
          continue;
        }
        const searchableEntry: SearchableEntry = {
          text: userText,
          groupId: chunk.id,
          messageType: 'user',
          itemType: 'user',
          timestamp: chunk.userMessage.timestamp.getTime(),
          messageUuid: chunk.userMessage.uuid,
        };
        this.collectMatchesForEntry(
          searchableEntry,
          query,
          results,
          maxResults,
          projectId,
          sessionId,
          sessionTitle
        );
        continue;
      }

      if (isEnhancedAIChunk(chunk)) {
        const lastOutputStep = this.findLastOutputTextStep(chunk.semanticSteps);
        const outputText = lastOutputStep?.content.outputText;
        if (!lastOutputStep || !outputText) {
          continue;
        }

        const searchableEntry: SearchableEntry = {
          text: outputText,
          groupId: chunk.id,
          messageType: 'assistant',
          itemType: 'ai',
          timestamp: lastOutputStep.startTime.getTime(),
          messageUuid: lastOutputStep.sourceMessageId ?? chunk.responses[0]?.uuid ?? '',
        };
        this.collectMatchesForEntry(
          searchableEntry,
          query,
          results,
          maxResults,
          projectId,
          sessionId,
          sessionTitle
        );
      }
    }

    return results;
  }

  private collectMatchesForEntry(
    entry: SearchableEntry,
    query: string,
    results: SearchResult[],
    maxResults: number,
    projectId: string,
    sessionId: string,
    sessionTitle?: string
  ): void {
    const mdMatches = findMarkdownSearchMatches(entry.text, query);
    if (mdMatches.length === 0) return;

    // Build plain text once for context snippet extraction
    const plainText = extractMarkdownPlainText(entry.text);
    const lowerPlain = plainText.toLowerCase();

    for (const mdMatch of mdMatches) {
      if (results.length >= maxResults) return;

      // Find approximate position in plain text for context extraction
      let pos = 0;
      for (let i = 0; i < mdMatch.matchIndexInItem; i++) {
        const idx = lowerPlain.indexOf(query, pos);
        if (idx === -1) break;
        pos = idx + query.length;
      }
      const matchPos = lowerPlain.indexOf(query, pos);
      const effectivePos = matchPos >= 0 ? matchPos : 0;

      const contextStart = Math.max(0, effectivePos - 50);
      const contextEnd = Math.min(plainText.length, effectivePos + query.length + 50);
      const context = plainText.slice(contextStart, contextEnd);
      const matchedText =
        matchPos >= 0 ? plainText.slice(matchPos, matchPos + query.length) : query;

      results.push({
        sessionId,
        projectId,
        sessionTitle: sessionTitle ?? 'Untitled Session',
        matchedText,
        context:
          (contextStart > 0 ? '...' : '') + context + (contextEnd < plainText.length ? '...' : ''),
        messageType: entry.messageType,
        timestamp: entry.timestamp,
        groupId: entry.groupId,
        itemType: entry.itemType,
        matchIndexInItem: mdMatch.matchIndexInItem,
        matchStartOffset: effectivePos,
        messageUuid: entry.messageUuid,
      });
    }
  }

  private extractUserSearchableText(message: ParsedMessage): string {
    let rawText = '';
    if (typeof message.content === 'string') {
      rawText = message.content;
    } else if (Array.isArray(message.content)) {
      rawText = message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
    }
    return sanitizeDisplayContent(rawText);
  }

  private findLastOutputTextStep(steps: SemanticStep[]): SemanticStep | null {
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      if (step.type === 'output' && step.content.outputText) {
        return step;
      }
    }
    return null;
  }
}
