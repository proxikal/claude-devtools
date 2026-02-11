import React, { useState } from 'react';

import { CARD_ICON_MUTED } from '@renderer/constants/cssVariables';
import { truncateText } from '@renderer/utils/aiGroupEnhancer';

import { LinkedToolItem } from './LinkedToolItem';
import { TextItem } from './TextItem';
import { ThinkingItem } from './ThinkingItem';

import type { AIGroupDisplayItem } from '@renderer/types/groups';
import type { TriggerColor } from '@shared/constants/triggerColors';

// =============================================================================
// Types
// =============================================================================

interface ExecutionTraceProps {
  items: AIGroupDisplayItem[];
  aiGroupId: string;
  highlightToolUseId?: string;
  /** Custom highlight color from trigger */
  highlightColor?: TriggerColor;
  /** Map of tool use ID to trigger color for notification dots */
  notificationColorMap?: Map<string, TriggerColor>;
  searchExpandedItemId?: string | null;
  /** Optional callback to register tool element refs for scroll targeting */
  registerToolRef?: (toolId: string, el: HTMLDivElement | null) => void;
}

// =============================================================================
// Execution Trace Component
// =============================================================================

export const ExecutionTrace: React.FC<ExecutionTraceProps> = ({
  items,
  aiGroupId: _aiGroupId,
  highlightToolUseId,
  highlightColor,
  notificationColorMap,
  searchExpandedItemId,
  registerToolRef,
}): React.JSX.Element => {
  const [manualExpandedItemId, setManualExpandedItemId] = useState<string | null>(null);

  // Use searchExpandedItemId if set, otherwise use manually expanded item
  const expandedItemId = searchExpandedItemId ?? manualExpandedItemId;

  const handleItemClick = (itemId: string): void => {
    setManualExpandedItemId((prev) => (prev === itemId ? null : itemId));
  };

  if (!items || items.length === 0) {
    return (
      <div className="px-3 py-2 text-xs" style={{ color: CARD_ICON_MUTED }}>
        No execution items
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {items.map((item, index) => {
        switch (item.type) {
          case 'thinking': {
            const itemId = `subagent-thinking-${index}`;
            const thinkingStep = {
              id: itemId,
              type: 'thinking' as const,
              startTime: item.timestamp,
              endTime: item.timestamp,
              durationMs: 0,
              content: { thinkingText: item.content, tokenCount: item.tokenCount },
              tokens: { input: 0, output: item.tokenCount ?? 0 },
              context: 'subagent' as const,
            };
            const preview = truncateText(item.content, 150);
            const isExpanded = expandedItemId === itemId;
            return (
              <ThinkingItem
                key={itemId}
                step={thinkingStep}
                preview={preview}
                onClick={() => handleItemClick(itemId)}
                isExpanded={isExpanded}
              />
            );
          }

          case 'output': {
            const itemId = `subagent-output-${index}`;
            const textStep = {
              id: itemId,
              type: 'output' as const,
              startTime: item.timestamp,
              endTime: item.timestamp,
              durationMs: 0,
              content: { outputText: item.content, tokenCount: item.tokenCount },
              tokens: { input: 0, output: item.tokenCount ?? 0 },
              context: 'subagent' as const,
            };
            const preview = truncateText(item.content, 150);
            const isExpanded = expandedItemId === itemId;
            return (
              <TextItem
                key={itemId}
                step={textStep}
                preview={preview}
                onClick={() => handleItemClick(itemId)}
                isExpanded={isExpanded}
              />
            );
          }

          case 'tool': {
            const itemId = `subagent-tool-${item.tool.id}`;
            const isExpanded = expandedItemId === itemId;
            const isHighlighted = highlightToolUseId === item.tool.id;
            return (
              <LinkedToolItem
                key={itemId}
                linkedTool={item.tool}
                onClick={() => handleItemClick(itemId)}
                isExpanded={isExpanded}
                isHighlighted={isHighlighted}
                highlightColor={highlightColor}
                notificationDotColor={notificationColorMap?.get(item.tool.id)}
                registerRef={
                  registerToolRef ? (el) => registerToolRef(item.tool.id, el) : undefined
                }
              />
            );
          }

          case 'subagent':
            return (
              <div
                key={`nested-subagent-${index}`}
                className="px-2 py-1 text-xs"
                style={{ color: CARD_ICON_MUTED }}
              >
                Nested: {item.subagent.description ?? item.subagent.id}
              </div>
            );

          default:
            return null;
        }
      })}
    </div>
  );
};
