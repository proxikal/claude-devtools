/**
 * ToolAutoExpandModal
 *
 * A portaled modal for selecting which tool call types auto-expand
 * when rendered in a transcript. Tools are grouped by category and
 * individually toggleable. Changes are applied immediately on close.
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';

import { X } from 'lucide-react';

// ─── Tool Catalog ─────────────────────────────────────────────────────────────

interface ToolEntry {
  name: string;
  label: string;
  description: string;
}

interface ToolCategory {
  label: string;
  tools: ToolEntry[];
}

const TOOL_CATEGORIES: ToolCategory[] = [
  {
    label: 'File Operations',
    tools: [
      { name: 'Read', label: 'Read', description: 'File reads' },
      { name: 'Write', label: 'Write', description: 'File writes' },
      { name: 'Edit', label: 'Edit', description: 'File edits / diffs' },
      { name: 'Bash', label: 'Bash', description: 'Shell commands' },
      { name: 'Glob', label: 'Glob', description: 'File pattern searches' },
      { name: 'Grep', label: 'Grep', description: 'Content searches' },
      { name: 'NotebookEdit', label: 'NotebookEdit', description: 'Jupyter notebook edits' },
    ],
  },
  {
    label: 'Web',
    tools: [
      { name: 'WebFetch', label: 'WebFetch', description: 'URL fetches' },
      { name: 'WebSearch', label: 'WebSearch', description: 'Web searches' },
    ],
  },
  {
    label: 'Tasks',
    tools: [
      { name: 'Task', label: 'Task', description: 'Subagent task spawns' },
      { name: 'TodoWrite', label: 'TodoWrite', description: 'Todo list updates' },
    ],
  },
  {
    label: 'Team',
    tools: [
      { name: 'TeamCreate', label: 'TeamCreate', description: 'Team creation' },
      { name: 'TaskCreate', label: 'TaskCreate', description: 'Task creation' },
      { name: 'TaskUpdate', label: 'TaskUpdate', description: 'Task updates' },
      { name: 'TaskList', label: 'TaskList', description: 'Task list queries' },
      { name: 'TaskGet', label: 'TaskGet', description: 'Task detail queries' },
      { name: 'SendMessage', label: 'SendMessage', description: 'Team messages' },
      { name: 'TeamDelete', label: 'TeamDelete', description: 'Team deletion' },
    ],
  },
];

const ALL_TOOL_NAMES = TOOL_CATEGORIES.flatMap((c) => c.tools.map((t) => t.name));

// ─── Component ────────────────────────────────────────────────────────────────

interface ToolAutoExpandModalProps {
  /** Currently enabled tool names */
  enabledTools: string[];
  onClose: (enabledTools: string[]) => void;
}

export const ToolAutoExpandModal = ({
  enabledTools,
  onClose,
}: ToolAutoExpandModalProps): React.JSX.Element => {
  // Local state — changes committed on close
  const [selected, setSelected] = useState<Set<string>>(() => new Set(enabledTools));

  const toggle = (name: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const selectAll = (): void => setSelected(new Set(ALL_TOOL_NAMES));
  const clearAll = (): void => setSelected(new Set());

  const handleClose = (): void => {
    onClose(Array.from(selected));
  };

  const selectedCount = selected.size;

  return createPortal(
    <>
      {/* Backdrop */}
      <button
        className="fixed inset-0 z-50 cursor-default"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
        onClick={handleClose}
        aria-label="Close tool auto-expand settings"
        tabIndex={-1}
      />

      {/* Panel */}
      <div
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg shadow-2xl"
        style={{
          backgroundColor: 'var(--color-surface-overlay)',
          border: '1px solid var(--color-border-emphasis)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-5 py-4"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
              Auto-expand Tool Calls
            </h2>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Selected tools expand automatically when a transcript loads
            </p>
          </div>
          <button
            onClick={handleClose}
            className="rounded-md p-1 transition-colors hover:bg-white/5"
            aria-label="Close"
          >
            <X className="size-4" style={{ color: 'var(--color-text-muted)' }} />
          </button>
        </div>

        {/* Select / Clear all */}
        <div
          className="flex items-center justify-between border-b px-5 py-2"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {selectedCount === 0
              ? 'None selected'
              : `${selectedCount} tool${selectedCount === 1 ? '' : 's'} selected`}
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={selectAll}
              className="text-xs transition-colors hover:underline"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Select all
            </button>
            <button
              onClick={clearAll}
              className="text-xs transition-colors hover:underline"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Clear all
            </button>
          </div>
        </div>

        {/* Tool list */}
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          <div className="space-y-5">
            {TOOL_CATEGORIES.map((category) => (
              <div key={category.label}>
                <p
                  className="mb-2 text-[10px] font-medium uppercase tracking-widest"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {category.label}
                </p>
                <div className="space-y-1">
                  {category.tools.map((tool) => {
                    const isEnabled = selected.has(tool.name);
                    return (
                      <button
                        key={tool.name}
                        onClick={() => toggle(tool.name)}
                        className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left transition-colors hover:bg-white/5"
                        style={{
                          backgroundColor: isEnabled ? 'rgba(99,102,241,0.08)' : 'transparent',
                        }}
                      >
                        <div className="flex items-center gap-2.5">
                          {/* Toggle indicator */}
                          <div
                            className="flex size-4 shrink-0 items-center justify-center rounded"
                            style={{
                              backgroundColor: isEnabled
                                ? 'rgba(99,102,241,0.9)'
                                : 'var(--color-surface-raised)',
                              border: isEnabled
                                ? '1px solid rgba(99,102,241,0.9)'
                                : '1px solid var(--color-border-emphasis)',
                            }}
                          >
                            {isEnabled && (
                              <svg
                                viewBox="0 0 10 8"
                                fill="none"
                                className="size-2.5"
                                stroke="white"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M1 4l2.5 2.5L9 1" />
                              </svg>
                            )}
                          </div>
                          <span
                            className="font-mono text-xs font-medium"
                            style={{
                              color: isEnabled
                                ? 'var(--color-text)'
                                : 'var(--color-text-secondary)',
                            }}
                          >
                            {tool.label}
                          </span>
                        </div>
                        <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                          {tool.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end border-t px-5 py-3"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <button
            onClick={handleClose}
            className="rounded-md px-4 py-1.5 text-sm font-medium text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: 'rgba(99,102,241,0.9)' }}
          >
            Done
          </button>
        </div>
      </div>
    </>,
    document.body
  );
};
