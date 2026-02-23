import React, { useState } from 'react';

import { COLOR_TEXT_MUTED, COLOR_TEXT_SECONDARY } from '@renderer/constants/cssVariables';
import { useTabUI } from '@renderer/hooks/useTabUI';
import { formatDuration, formatTokensCompact } from '@renderer/utils/formatters';
import { getToolContextTokens } from '@renderer/utils/toolRendering';
import { Check, ChevronDown, Clipboard, Clock, Sigma, Zap } from 'lucide-react';

import type { Process } from '@renderer/types/data';
import type { AIGroup, AIGroupDisplayItem } from '@renderer/types/groups';

// =============================================================================
// Helpers
// =============================================================================

interface ToolCount {
  name: string;
  count: number;
  errorCount: number;
}

function buildToolCounts(steps: AIGroup['steps']): ToolCount[] {
  const map = new Map<string, { count: number; errorCount: number }>();

  for (const step of steps) {
    if (step.type !== 'tool_call') continue;
    const name = step.content.toolName ?? 'Unknown';
    const existing = map.get(name) ?? { count: 0, errorCount: 0 };
    existing.count += 1;
    map.set(name, existing);
  }

  // Track errors from tool_result steps
  for (const step of steps) {
    if (step.type !== 'tool_result') continue;
    if (!step.content.isError) continue;
    const name = step.content.toolName ?? 'Unknown';
    const existing = map.get(name);
    if (existing) {
      existing.errorCount += 1;
      map.set(name, existing);
    }
  }

  return Array.from(map.entries())
    .map(([name, { count, errorCount }]) => ({ name, count, errorCount }))
    .sort((a, b) => b.count - a.count);
}

// =============================================================================
// Sub-components
// =============================================================================

const ToolGrid = ({ toolCounts }: { toolCounts: ToolCount[] }): React.JSX.Element | null => {
  if (toolCounts.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {toolCounts.map(({ name, count, errorCount }) => (
        <span
          key={name}
          className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs"
          style={{
            backgroundColor: errorCount > 0 ? 'var(--tool-result-error-bg)' : 'var(--tag-bg)',
            border: `1px solid ${errorCount > 0 ? 'var(--tool-result-error-border)' : 'var(--tag-border)'}`,
            color: errorCount > 0 ? 'var(--tool-result-error-text)' : 'var(--tag-text)',
          }}
        >
          <code className="font-mono">{name}</code>
          {count > 1 && <span className="opacity-70">×{count}</span>}
          {errorCount > 0 && <span className="font-medium">⚠</span>}
        </span>
      ))}
    </div>
  );
};

const SubagentRow = ({ process }: { process: Process }): React.JSX.Element => {
  const label = process.subagentType ?? process.description ?? process.id.slice(0, 8);
  // Count tool_call steps from process messages
  const toolCount = process.messages.reduce((sum, msg) => {
    if (msg.type === 'assistant' && Array.isArray(msg.content)) {
      return sum + msg.content.filter((b: { type: string }) => b.type === 'tool_use').length;
    }
    return sum;
  }, 0);

  return (
    <div className="flex items-center gap-3 text-xs" style={{ color: COLOR_TEXT_MUTED }}>
      <span className="w-1 shrink-0 text-center">╰</span>
      <span className="font-medium" style={{ color: COLOR_TEXT_SECONDARY }}>
        {label}
      </span>
      {toolCount > 0 && (
        <span>
          {toolCount} tool{toolCount !== 1 ? 's' : ''}
        </span>
      )}
      {process.durationMs > 0 && (
        <span className="flex items-center gap-1">
          <Clock className="size-3" />
          {formatDuration(process.durationMs)}
        </span>
      )}
      {process.metrics.totalTokens != null && process.metrics.totalTokens > 0 && (
        <span className="flex items-center gap-1">
          <Sigma className="size-3" />
          {formatTokensCompact(process.metrics.totalTokens)}
        </span>
      )}
    </div>
  );
};

// =============================================================================
// Digest Builder
// =============================================================================

/**
 * Builds a compact structured text digest of the task — safe to paste to Claude
 * for accuracy assessment without dumping full tool content.
 */
function buildTaskDigest(
  aiGroup: AIGroup,
  displayItems: AIGroupDisplayItem[],
  toolCounts: ToolCount[],
  totalTokens: number
): string {
  const lines: string[] = [];

  const duration = aiGroup.durationMs > 0 ? formatDuration(aiGroup.durationMs) : null;
  const totalTools = toolCounts.reduce((s, t) => s + t.count, 0);
  const totalErrors = toolCounts.reduce((s, t) => s + t.errorCount, 0);

  lines.push(
    `Task Summary — ${totalTools} tool${totalTools !== 1 ? 's' : ''}${duration ? ` · ${duration}` : ''} · ${totalTokens.toLocaleString()} tokens`
  );

  // Per-tool-type token breakdown
  if (toolCounts.length > 0) {
    // Aggregate tokens per tool name from displayItems
    const tokensByTool = new Map<string, number>();
    for (const item of displayItems) {
      if (item.type !== 'tool') continue;
      const name = item.tool.name ?? 'Unknown';
      tokensByTool.set(name, (tokensByTool.get(name) ?? 0) + getToolContextTokens(item.tool));
    }
    lines.push('');
    lines.push('Tools:');
    for (const { name, count, errorCount } of toolCounts) {
      const t = tokensByTool.get(name) ?? 0;
      const err = errorCount > 0 ? ` [${errorCount} error${errorCount !== 1 ? 's' : ''}]` : '';
      lines.push(`  ${name} ×${count}: ${t.toLocaleString()} tokens${err}`);
    }
  }

  // Thinking + output token totals
  let thinkingTokens = 0;
  let outputTokens = 0;
  for (const item of displayItems) {
    if (item.type === 'thinking') thinkingTokens += item.tokenCount ?? 0;
    if (item.type === 'output') outputTokens += item.tokenCount ?? 0;
  }
  if (thinkingTokens > 0 || outputTokens > 0) {
    lines.push('');
    if (thinkingTokens > 0) lines.push(`Thinking: ${thinkingTokens.toLocaleString()} tokens`);
    if (outputTokens > 0) lines.push(`Output text: ${outputTokens.toLocaleString()} tokens`);
  }

  // Subagents
  if (aiGroup.processes.length > 0) {
    lines.push('');
    lines.push('Subagents:');
    for (const proc of aiGroup.processes) {
      const label = proc.subagentType ?? proc.description ?? proc.id.slice(0, 8);
      const dur = proc.durationMs > 0 ? ` · ${formatDuration(proc.durationMs)}` : '';
      const tok =
        proc.metrics.totalTokens > 0
          ? ` · ${proc.metrics.totalTokens.toLocaleString()} tokens`
          : '';
      lines.push(`  ${label}${dur}${tok}`);
    }
  }

  lines.push('');
  lines.push(
    `Total: ${totalTokens.toLocaleString()} tokens${duration ? ` · ${duration}` : ''}${totalErrors > 0 ? ` · ${totalErrors} error${totalErrors !== 1 ? 's' : ''}` : ''}`
  );

  return lines.join('\n');
}

// =============================================================================
// Main Component
// =============================================================================

interface TaskSummaryProps {
  aiGroup: AIGroup;
  displayItems: AIGroupDisplayItem[];
}

export const TaskSummary = ({
  aiGroup,
  displayItems,
}: Readonly<TaskSummaryProps>): React.JSX.Element | null => {
  const { isTaskSummaryExpanded, toggleTaskSummary } = useTabUI();
  const isExpanded = isTaskSummaryExpanded(aiGroup.id);
  const [copied, setCopied] = useState(false);

  const toolCounts = buildToolCounts(aiGroup.steps);
  const subagents = aiGroup.processes;
  const totalTools = toolCounts.reduce((sum, t) => sum + t.count, 0);
  const totalErrors = toolCounts.reduce((sum, t) => sum + t.errorCount, 0);

  // Sum tokens using the exact same sources as the per-step labels in the UI:
  // - tool items: getToolContextTokens (callTokens + result.tokenCount)
  // - thinking/output items: tokenCount
  const totalTokens = displayItems.reduce((sum, item) => {
    if (item.type === 'tool') return sum + getToolContextTokens(item.tool);
    if (item.type === 'thinking' || item.type === 'output') return sum + (item.tokenCount ?? 0);
    return sum;
  }, 0);

  // Nothing meaningful to show
  if (totalTokens === 0 && totalTools === 0 && subagents.length === 0 && aiGroup.durationMs === 0)
    return null;

  const handleCopy = (e: React.MouseEvent): void => {
    e.stopPropagation();
    const digest = buildTaskDigest(aiGroup, displayItems, toolCounts, totalTokens);
    void navigator.clipboard.writeText(digest).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  // Collapsed header label
  const parts: string[] = [];
  if (totalTools > 0) parts.push(`${totalTools} tool${totalTools !== 1 ? 's' : ''}`);
  if (subagents.length > 0)
    parts.push(`${subagents.length} subagent${subagents.length !== 1 ? 's' : ''}`);
  if (aiGroup.durationMs > 0) parts.push(formatDuration(aiGroup.durationMs));

  return (
    <div
      className="mt-1 overflow-hidden rounded-lg"
      style={{
        backgroundColor: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
      }}
    >
      {/* Header — always visible, clickable */}
      <div
        role="button"
        tabIndex={0}
        className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:opacity-80"
        style={{ color: COLOR_TEXT_MUTED }}
        onClick={() => toggleTaskSummary(aiGroup.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleTaskSummary(aiGroup.id);
          }
        }}
      >
        <Zap className="size-3 shrink-0" />
        <span className="font-medium" style={{ color: COLOR_TEXT_SECONDARY }}>
          Task Summary
        </span>
        <span className="mx-1">·</span>
        <span>{parts.join('  ·  ')}</span>
        {totalErrors > 0 && (
          <>
            <span className="mx-1">·</span>
            <span style={{ color: 'var(--tool-result-error-text)' }}>
              {totalErrors} error{totalErrors !== 1 ? 's' : ''}
            </span>
          </>
        )}
        {totalTokens > 0 && (
          <>
            <span className="mx-1">·</span>
            <span className="flex items-center gap-1">
              <Sigma className="size-3" />
              {formatTokensCompact(totalTokens)}
            </span>
          </>
        )}
        <button
          type="button"
          className="ml-auto mr-1 rounded p-0.5 opacity-40 transition-opacity hover:opacity-100"
          title="Copy task digest"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="size-3" style={{ color: 'var(--tag-text)' }} />
          ) : (
            <Clipboard className="size-3" />
          )}
        </button>
        <ChevronDown
          className={`size-3 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        />
      </div>

      {/* Expanded body */}
      {isExpanded && (
        <div
          className="space-y-3 px-3 pb-3 pt-2"
          style={{ borderTop: '1px solid var(--card-border)' }}
        >
          {/* Tool breakdown */}
          {toolCounts.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium" style={{ color: COLOR_TEXT_MUTED }}>
                Tools used
              </div>
              <ToolGrid toolCounts={toolCounts} />
            </div>
          )}

          {/* Subagents */}
          {subagents.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium" style={{ color: COLOR_TEXT_MUTED }}>
                Subagents
              </div>
              <div className="space-y-1">
                {subagents.map((proc) => (
                  <SubagentRow key={proc.id} process={proc} />
                ))}
              </div>
            </div>
          )}

          {/* Duration + token summary row */}
          <div className="flex items-center gap-4 text-xs" style={{ color: COLOR_TEXT_MUTED }}>
            {aiGroup.durationMs > 0 && (
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                {formatDuration(aiGroup.durationMs)}
              </span>
            )}
            {totalTokens > 0 && (
              <span className="flex items-center gap-1">
                <Sigma className="size-3" />
                {formatTokensCompact(totalTokens)} tokens
              </span>
            )}
            {totalErrors > 0 && (
              <span style={{ color: 'var(--tool-result-error-text)' }}>
                {totalErrors} error{totalErrors !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
