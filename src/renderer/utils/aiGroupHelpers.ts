/**
 * AI Group Helpers - Utility functions for AI Group enhancement
 *
 * Small, focused utility functions used across the AI Group enhancement modules.
 */

import { createLogger } from '@shared/utils/logger';
import { estimateTokens } from '@shared/utils/tokenFormatting';

import type { Process } from '../types/data';
import type { LinkedToolItem } from '../types/groups';

const logger = createLogger('Util:aiGroupHelpers');

// Re-export for backwards compatibility
export { estimateTokens };

/**
 * Safely converts a timestamp to a Date object.
 * Handles both Date objects and ISO string timestamps (from IPC serialization).
 */
export function toDate(timestamp: Date | string | number): Date {
  if (timestamp instanceof Date) {
    return timestamp;
  }
  return new Date(timestamp);
}

/**
 * Truncates text to a maximum length and adds ellipsis if needed.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + '...';
}

/**
 * Converts tool input object to a preview string.
 */
export function formatToolInput(input: Record<string, unknown>): string {
  try {
    const json = JSON.stringify(input, null, 2);
    return truncateText(json, 100);
  } catch (error) {
    logger.debug('formatToolInput failed:', error);
    return '[Invalid JSON]';
  }
}

/**
 * Converts tool result content to a preview string.
 */
export function formatToolResult(content: string | unknown[]): string {
  try {
    if (typeof content === 'string') {
      return truncateText(content, 200);
    }
    const json = JSON.stringify(content, null, 2);
    return truncateText(json, 200);
  } catch (error) {
    logger.debug('formatToolResult failed:', error);
    return '[Invalid content]';
  }
}

/**
 * Attaches main session impact tokens to subagents.
 * For each subagent with a parentTaskId, finds the matching Task tool
 * and extracts the callTokens and resultTokens that affect the main session.
 *
 * This allows SubagentItem to display both:
 * - Main session impact: tokens consumed by the Task tool_call + tool_result in the parent session
 * - Subagent isolated context: the subagent's internal token usage
 *
 * @param subagents - Array of subagents to enhance
 * @param linkedTools - Map of tool IDs to LinkedToolItem (includes Task tools)
 * @returns The same subagents array with mainSessionImpact populated
 */
export function attachMainSessionImpact(
  subagents: Process[],
  linkedTools: Map<string, LinkedToolItem>
): Process[] {
  for (const subagent of subagents) {
    if (subagent.parentTaskId) {
      const taskTool = linkedTools.get(subagent.parentTaskId);
      if (taskTool) {
        const callTokens = taskTool.callTokens ?? 0;
        const resultTokens = taskTool.result?.tokenCount ?? 0;
        subagent.mainSessionImpact = {
          callTokens,
          resultTokens,
          totalTokens: callTokens + resultTokens,
        };
      }
    }
  }
  return subagents;
}
