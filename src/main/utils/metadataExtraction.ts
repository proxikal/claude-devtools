/**
 * Metadata extraction utilities for parsing first messages and session context from JSONL files.
 */

import { createLogger } from '@shared/utils/logger';
import * as fs from 'fs';
import * as readline from 'readline';

import { type ChatHistoryEntry } from '../types';

const logger = createLogger('Util:metadataExtraction');

/**
 * Extract CWD (current working directory) from the first entry.
 * Used to get the actual project path from encoded directory names.
 */
export async function extractCwd(filePath: string): Promise<string | null> {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;

      const entry = JSON.parse(line) as ChatHistoryEntry;
      // Only conversational entries have cwd
      if ('cwd' in entry && entry.cwd) {
        fileStream.destroy();
        return entry.cwd;
      }
    }
  } catch (error) {
    logger.error(`Error extracting cwd from ${filePath}:`, error);
  }

  return null;
}
