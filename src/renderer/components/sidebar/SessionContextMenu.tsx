/**
 * SessionContextMenu - Right-click context menu for sidebar session items.
 * Supports opening in current pane, new tab, and split right.
 * Shows keyboard shortcut hints for actions that have them.
 */

import { useEffect, useRef } from 'react';

import { MAX_PANES } from '@renderer/types/panes';
import { Pin, PinOff } from 'lucide-react';

interface SessionContextMenuProps {
  x: number;
  y: number;
  sessionId: string;
  projectId: string;
  sessionLabel: string;
  paneCount: number;
  isPinned: boolean;
  onClose: () => void;
  onOpenInCurrentPane: () => void;
  onOpenInNewTab: () => void;
  onSplitRightAndOpen: () => void;
  onTogglePin: () => void;
}

export const SessionContextMenu = ({
  x,
  y,
  paneCount,
  isPinned,
  onClose,
  onOpenInCurrentPane,
  onOpenInNewTab,
  onSplitRightAndOpen,
  onTogglePin,
}: SessionContextMenuProps): React.JSX.Element => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const menuWidth = 240;
  const menuHeight = 180;
  const clampedX = Math.min(x, window.innerWidth - menuWidth - 8);
  const clampedY = Math.min(y, window.innerHeight - menuHeight - 8);

  const handleClick = (action: () => void) => () => {
    action();
    onClose();
  };

  const atMaxPanes = paneCount >= MAX_PANES;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[220px] overflow-hidden rounded-md border py-1 shadow-lg"
      style={{
        left: clampedX,
        top: clampedY,
        backgroundColor: 'var(--color-surface-overlay)',
        borderColor: 'var(--color-border-emphasis)',
        color: 'var(--color-text)',
      }}
    >
      <MenuItem label="Open in Current Pane" onClick={handleClick(onOpenInCurrentPane)} />
      <MenuItem label="Open in New Tab" shortcut="⌘ Click" onClick={handleClick(onOpenInNewTab)} />
      <div className="mx-2 my-1 border-t" style={{ borderColor: 'var(--color-border)' }} />
      <MenuItem
        label="Split Right and Open"
        onClick={handleClick(onSplitRightAndOpen)}
        disabled={atMaxPanes}
      />
      <div className="mx-2 my-1 border-t" style={{ borderColor: 'var(--color-border)' }} />
      <MenuItem
        label={isPinned ? 'Unpin Session' : 'Pin Session'}
        icon={isPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
        onClick={handleClick(onTogglePin)}
      />
    </div>
  );
};

const MenuItem = ({
  label,
  shortcut,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  shortcut?: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}): React.JSX.Element => {
  return (
    <button
      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--color-surface-raised)]"
      onClick={onClick}
      disabled={disabled}
      style={{ opacity: disabled ? 0.4 : 1 }}
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      {shortcut && (
        <span className="ml-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {shortcut}
        </span>
      )}
    </button>
  );
};
