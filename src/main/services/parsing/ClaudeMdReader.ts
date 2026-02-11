/**
 * ClaudeMdReader service - Reads CLAUDE.md files and calculates token counts.
 *
 * Responsibilities:
 * - Read CLAUDE.md files from various locations
 * - Calculate character counts and estimate token counts
 * - Handle file not found gracefully
 * - Support tilde (~) expansion to home directory
 */

import { encodePath } from '@main/utils/pathDecoder';
import { countTokens } from '@main/utils/tokenizer';
import { createLogger } from '@shared/utils/logger';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const logger = createLogger('Service:ClaudeMdReader');

// ===========================================================================
// Types
// ===========================================================================

export interface ClaudeMdFileInfo {
  path: string;
  exists: boolean;
  charCount: number;
  estimatedTokens: number; // charCount / 4
}

export interface ClaudeMdReadResult {
  files: Map<string, ClaudeMdFileInfo>;
}

// ===========================================================================
// Helper Functions
// ===========================================================================

/**
 * Expands tilde (~) in a path to the actual home directory.
 * @param filePath - Path that may contain ~
 * @returns Expanded path with ~ replaced by home directory
 */
function expandTilde(filePath: string): string {
  if (filePath.startsWith('~')) {
    const homeDir = app.getPath('home');
    return path.join(homeDir, filePath.slice(1));
  }
  return filePath;
}

// ===========================================================================
// Main Functions
// ===========================================================================

/**
 * Reads a single CLAUDE.md file and returns its info.
 * @param filePath - Path to the CLAUDE.md file (supports ~ expansion)
 * @returns ClaudeMdFileInfo with file details
 */
function readClaudeMdFile(filePath: string): ClaudeMdFileInfo {
  const expandedPath = expandTilde(filePath);

  try {
    if (!fs.existsSync(expandedPath)) {
      return {
        path: expandedPath,
        exists: false,
        charCount: 0,
        estimatedTokens: 0,
      };
    }

    const content = fs.readFileSync(expandedPath, 'utf8');
    const charCount = content.length;
    const estimatedTokens = countTokens(content);

    return {
      path: expandedPath,
      exists: true,
      charCount,
      estimatedTokens,
    };
  } catch (error) {
    // Handle permission denied, file not readable, etc.
    logger.error(`Error reading CLAUDE.md file at ${expandedPath}:`, error);
    return {
      path: expandedPath,
      exists: false,
      charCount: 0,
      estimatedTokens: 0,
    };
  }
}

/**
 * Reads all .md files in a directory and returns combined info.
 * Used for project rules directory.
 * @param dirPath - Path to the directory (supports ~ expansion)
 * @returns ClaudeMdFileInfo with combined stats from all .md files
 */
function readDirectoryMdFiles(dirPath: string): ClaudeMdFileInfo {
  const expandedPath = expandTilde(dirPath);

  try {
    if (!fs.existsSync(expandedPath)) {
      return {
        path: expandedPath,
        exists: false,
        charCount: 0,
        estimatedTokens: 0,
      };
    }

    const stats = fs.statSync(expandedPath);
    if (!stats.isDirectory()) {
      return {
        path: expandedPath,
        exists: false,
        charCount: 0,
        estimatedTokens: 0,
      };
    }

    const mdFiles = collectMdFiles(expandedPath);

    if (mdFiles.length === 0) {
      return {
        path: expandedPath,
        exists: false,
        charCount: 0,
        estimatedTokens: 0,
      };
    }

    let totalCharCount = 0;
    const allContent: string[] = [];

    for (const filePath of mdFiles) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        totalCharCount += content.length;
        allContent.push(content);
      } catch {
        // Skip files we can't read
        continue;
      }
    }

    // Count tokens on combined content for accuracy
    const estimatedTokens = countTokens(allContent.join('\n'));

    return {
      path: expandedPath,
      exists: true,
      charCount: totalCharCount,
      estimatedTokens,
    };
  } catch (error) {
    logger.error(`Error reading directory ${expandedPath}:`, error);
    return {
      path: expandedPath,
      exists: false,
      charCount: 0,
      estimatedTokens: 0,
    };
  }
}

/**
 * Recursively collect all .md files in a directory tree.
 */
function collectMdFiles(dir: string): string[] {
  const mdFiles: string[] = [];
  try {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      try {
        const stats = fs.statSync(fullPath);
        if (stats.isFile() && entry.endsWith('.md')) {
          mdFiles.push(fullPath);
        } else if (stats.isDirectory()) {
          mdFiles.push(...collectMdFiles(fullPath));
        }
      } catch {
        continue;
      }
    }
  } catch {
    // Directory not readable
  }
  return mdFiles;
}

/**
 * Returns the platform-specific enterprise CLAUDE.md path.
 */
function getEnterprisePath(): string {
  switch (process.platform) {
    case 'win32':
      return 'C:\\Program Files\\ClaudeCode\\CLAUDE.md';
    case 'darwin':
      return '/Library/Application Support/ClaudeCode/CLAUDE.md';
    default:
      return '/etc/claude-code/CLAUDE.md';
  }
}

/**
 * Reads auto memory MEMORY.md file for a project.
 * Only reads the first 200 lines, matching Claude Code behavior.
 */
function readAutoMemoryFile(projectRoot: string): ClaudeMdFileInfo {
  const expandedRoot = expandTilde(projectRoot);
  const encoded = encodePath(expandedRoot);
  const homeDir = app.getPath('home');
  const memoryPath = path.join(homeDir, '.claude', 'projects', encoded, 'memory', 'MEMORY.md');

  try {
    if (!fs.existsSync(memoryPath)) {
      return { path: memoryPath, exists: false, charCount: 0, estimatedTokens: 0 };
    }

    const content = fs.readFileSync(memoryPath, 'utf8');
    // Only first 200 lines, matching Claude Code behavior
    const lines = content.split('\n');
    const truncated = lines.slice(0, 200).join('\n');
    const charCount = truncated.length;
    const estimatedTokens = countTokens(truncated);

    return { path: memoryPath, exists: true, charCount, estimatedTokens };
  } catch (error) {
    logger.error(`Error reading auto memory at ${memoryPath}:`, error);
    return { path: memoryPath, exists: false, charCount: 0, estimatedTokens: 0 };
  }
}

/**
 * Reads all potential CLAUDE.md locations for a project.
 * @param projectRoot - The root directory of the project
 * @returns ClaudeMdReadResult with Map of path -> ClaudeMdFileInfo
 */
export function readAllClaudeMdFiles(projectRoot: string): ClaudeMdReadResult {
  const files = new Map<string, ClaudeMdFileInfo>();
  const expandedProjectRoot = expandTilde(projectRoot);

  // 1. Enterprise CLAUDE.md (platform-specific path)
  const enterprisePath = getEnterprisePath();
  files.set('enterprise', readClaudeMdFile(enterprisePath));

  // 2. User memory: ~/.claude/CLAUDE.md
  const userMemoryPath = '~/.claude/CLAUDE.md';
  files.set('user', readClaudeMdFile(userMemoryPath));

  // 3. Project memory: ${projectRoot}/CLAUDE.md
  const projectMemoryPath = path.join(expandedProjectRoot, 'CLAUDE.md');
  files.set('project', readClaudeMdFile(projectMemoryPath));

  // 4. Project memory alt: ${projectRoot}/.claude/CLAUDE.md
  const projectMemoryAltPath = path.join(expandedProjectRoot, '.claude', 'CLAUDE.md');
  files.set('project-alt', readClaudeMdFile(projectMemoryAltPath));

  // 5. Project rules: ${projectRoot}/.claude/rules/*.md
  const projectRulesPath = path.join(expandedProjectRoot, '.claude', 'rules');
  files.set('project-rules', readDirectoryMdFiles(projectRulesPath));

  // 6. Project local: ${projectRoot}/CLAUDE.local.md
  const projectLocalPath = path.join(expandedProjectRoot, 'CLAUDE.local.md');
  files.set('project-local', readClaudeMdFile(projectLocalPath));

  // 7. User rules: ~/.claude/rules/**/*.md
  const homeDir = app.getPath('home');
  const userRulesPath = path.join(homeDir, '.claude', 'rules');
  files.set('user-rules', readDirectoryMdFiles(userRulesPath));

  // 8. Auto memory: ~/.claude/projects/<encoded>/memory/MEMORY.md
  files.set('auto-memory', readAutoMemoryFile(projectRoot));

  return { files };
}

/**
 * Reads a specific directory's CLAUDE.md file.
 * Used for directory-specific CLAUDE.md detected from file reads.
 * @param dirPath - Path to the directory (supports ~ expansion)
 * @returns ClaudeMdFileInfo for the CLAUDE.md file in that directory
 */
export function readDirectoryClaudeMd(dirPath: string): ClaudeMdFileInfo {
  const expandedDirPath = expandTilde(dirPath);
  const claudeMdPath = path.join(expandedDirPath, 'CLAUDE.md');
  return readClaudeMdFile(claudeMdPath);
}
