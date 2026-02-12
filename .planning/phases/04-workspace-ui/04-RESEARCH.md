# Phase 4: Workspace UI - Research

**Researched:** 2026-02-12
**Domain:** React UI components, Electron desktop patterns, workspace/connection management UI
**Confidence:** HIGH

## Summary

Phase 4 delivers the final UI layer for workspace switching, building on Phases 1-3's infrastructure. The core challenge is creating an intuitive workspace switcher and persistent status indicators that integrate seamlessly with the existing sidebar-based layout without disrupting established patterns.

**Key findings:**
- Existing codebase already has dropdown/selector patterns to follow (SidebarHeader project/worktree selectors, CommandPalette, SettingsSelect)
- VS Code model places workspace indicators on left side of status bar; this app lacks a traditional status bar but has SidebarHeader
- Keyboard shortcuts use Cmd/Ctrl+K pattern already (CommandPalette); context switching could use Cmd/Ctrl+Shift+K or similar to avoid collision
- Connection states need distinct visual treatment: connected (green), connecting (spinner), disconnected (neutral), error (red)
- SSH profiles already stored in ConfigManager; settings UI needs CRUD interface following existing NotificationTriggerSettings pattern

**Primary recommendation:** Place context switcher in SidebarHeader Row 1 (alongside project name), add connection status badge next to switcher, implement settings section for SSH profile management, register Cmd/Ctrl+Shift+K shortcut for quick switching.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React 18.x | 18.x | UI framework | Already used throughout codebase |
| Zustand 4.x | 4.x | State management | Already used for contextSlice, connectionSlice |
| Tailwind CSS 3.x | 3.x | Styling | Theme-aware CSS variables already established |
| lucide-react | latest | Icons | Consistent with existing icon usage |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| date-fns | latest | Date formatting | Already used in CommandPalette for "last active" display |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom dropdown | Headless UI Listbox | Headless UI adds dependency but provides accessibility features. Codebase already has working custom dropdowns (SidebarHeader, SettingsSelect) — stick with existing patterns for consistency. |
| Custom dropdown | Radix UI Dropdown Menu | Radix provides ARIA-compliant primitives with collision detection. Same tradeoff as Headless UI — codebase patterns work well, adding library introduces dependency for marginal benefit. |

**Installation:**
```bash
# No new dependencies needed - use existing stack
```

## Architecture Patterns

### Recommended Project Structure
```
src/renderer/components/
├── common/
│   ├── ContextSwitcher.tsx          # Main switcher component
│   ├── ContextSwitchOverlay.tsx     # Already exists
│   └── ConnectionStatusBadge.tsx    # Status indicator
├── layout/
│   └── SidebarHeader.tsx            # Modified to include switcher
├── settings/
│   └── sections/
│       └── WorkspaceSection.tsx     # SSH profile management
```

### Pattern 1: Context Switcher Component
**What:** Dropdown component listing Local + all SSH contexts, with connection status indicators and keyboard navigation.
**When to use:** Embedded in SidebarHeader Row 1 alongside project name.
**Example:**
```typescript
// Based on existing SidebarHeader dropdown pattern
interface ContextSwitcherProps {
  activeContextId: string;
  onSwitch: (contextId: string) => void;
}

export const ContextSwitcher: React.FC<ContextSwitcherProps> = ({
  activeContextId,
  onSwitch
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click (same pattern as SidebarHeader)
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on escape (same pattern as SidebarHeader)
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  const contexts = useStore((s) => s.availableContexts); // From contextSlice

  return (
    <div ref={dropdownRef} className="relative">
      <button onClick={() => setIsOpen(!isOpen)}>
        <ConnectionStatusBadge contextId={activeContextId} />
        <span>{activeContextId === 'local' ? 'Local' : activeContextId.replace('ssh-', '')}</span>
        <ChevronDown className={isOpen ? 'rotate-180' : ''} />
      </button>

      {isOpen && (
        <div className="absolute dropdown-menu">
          {contexts.map(ctx => (
            <button
              key={ctx.id}
              onClick={() => { onSwitch(ctx.id); setIsOpen(false); }}
            >
              {ctx.type === 'local' ? 'Local' : ctx.id.replace('ssh-', '')}
              {ctx.id === activeContextId && <Check />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
```

### Pattern 2: Connection Status Badge
**What:** Visual indicator showing connection state with distinct colors/icons.
**When to use:** Always visible next to active context name.
**Example:**
```typescript
// Similar to OngoingIndicator pattern
type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'error';

export const ConnectionStatusBadge: React.FC<{ contextId: string }> = ({
  contextId
}) => {
  const state = useStore((s) =>
    contextId === 'local'
      ? 'connected'
      : s.connectionState
  );

  if (contextId === 'local') {
    return <Monitor className="size-4 text-text-muted" />;
  }

  // SSH context
  switch (state) {
    case 'connected':
      return <Wifi className="size-4 text-green-400" />;
    case 'connecting':
      return <Loader2 className="size-4 animate-spin text-text-muted" />;
    case 'disconnected':
      return <WifiOff className="size-4 text-text-muted" />;
    case 'error':
      return <WifiOff className="size-4 text-red-400" />;
  }
};
```

### Pattern 3: SSH Profile Management Settings Section
**What:** Settings section for creating, editing, deleting SSH connection profiles.
**When to use:** Settings view under new "Workspace" tab.
**Example:**
```typescript
// Follow NotificationTriggerSettings pattern
export const WorkspaceSection: React.FC = () => {
  const [profiles, setProfiles] = useState<SshConnectionProfile[]>([]);
  const [editingProfile, setEditingProfile] = useState<string | null>(null);

  // CRUD operations via ConfigManager IPC
  const handleAddProfile = async (profile: Omit<SshConnectionProfile, 'id'>) => {
    await window.electronAPI.config.update('ssh', {
      profiles: [...profiles, { ...profile, id: generateId() }]
    });
    await loadProfiles();
  };

  const handleEditProfile = async (id: string, updates: Partial<SshConnectionProfile>) => {
    // Update via ConfigManager
  };

  const handleDeleteProfile = async (id: string) => {
    // Delete via ConfigManager
  };

  return (
    <div className="space-y-6">
      <SettingsSectionHeader title="SSH Connection Profiles" />

      {profiles.map(profile => (
        <ProfileCard
          key={profile.id}
          profile={profile}
          onEdit={handleEditProfile}
          onDelete={handleDeleteProfile}
        />
      ))}

      <AddProfileForm onSubmit={handleAddProfile} />
    </div>
  );
};
```

### Pattern 4: Keyboard Shortcut Registration
**What:** Register Cmd/Ctrl+Shift+K for quick context switching.
**When to use:** Registered in useKeyboardShortcuts hook.
**Example:**
```typescript
// Add to useKeyboardShortcuts.ts
if (event.key === 'k' && event.shiftKey) {
  event.preventDefault();
  // Open context switcher dropdown or cycle to next context
  const currentIndex = contexts.findIndex(c => c.id === activeContextId);
  const nextContext = contexts[(currentIndex + 1) % contexts.length];
  void switchContext(nextContext.id);
  return;
}
```

### Anti-Patterns to Avoid
- **Don't add status bar component**: App uses sidebar-centric layout (not bottom status bar like VS Code). Place indicators in SidebarHeader instead.
- **Don't block UI during switch**: ContextSwitchOverlay already exists for loading state — use it, don't create inline spinners that block interaction.
- **Don't duplicate connection state**: connectionSlice and contextSlice both track state — contextSlice owns activeContextId, connectionSlice owns SSH connection state. Don't mix concerns.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dropdown accessibility (focus trap, escape, arrow navigation) | Custom keyboard handler | Follow existing SidebarHeader pattern | Codebase already has working dropdown with keyboard support. Headless UI/Radix would add dependency for marginal benefit. |
| Context switch animation | Custom fade/slide | ContextSwitchOverlay (already exists) | Overlay prevents stale data flash during transition. Don't reinvent. |
| SSH config parsing | Custom parser | Use main process SshConnectionManager (already exists) | Main process already resolves SSH config hosts via `ssh.getConfigHosts()` IPC. |
| Profile persistence | IndexedDB or localStorage | ConfigManager (already exists) | SSH profiles already stored in config.json via ConfigManager. Don't create separate storage. |

**Key insight:** This phase is primarily UI composition, not new infrastructure. Almost all backend logic exists from Phases 1-3. Focus on clean UI patterns that match existing components.

## Common Pitfalls

### Pitfall 1: Dropdown Positioning Conflict with macOS Traffic Lights
**What goes wrong:** Context switcher dropdown placed too close to window edge overlaps with macOS traffic lights (close/minimize/zoom buttons).
**Why it happens:** SidebarHeader Row 1 uses `--macos-traffic-light-padding-left` to avoid traffic lights, but dropdown menu anchoring doesn't account for this.
**How to avoid:** Use `inset-x-4` (same as SidebarHeader project dropdown) to ensure dropdown stays within safe area. See SidebarHeader.tsx line 381.
**Warning signs:** Dropdown menu appears behind or overlapping traffic lights on macOS.

### Pitfall 2: Context Switch State Race Condition
**What goes wrong:** User rapidly clicks between contexts, causing stale state to be restored.
**Why it happens:** contextSlice.switchContext is async; second click can start before first completes.
**How to avoid:** Disable switcher UI while `isContextSwitching` is true. Add guard in switchContext to early-return if already switching.
**Warning signs:** Console errors about "Cannot read property of undefined" after rapid switching; snapshot restore fails validation.

### Pitfall 3: SSH Connection Status Not Updating in UI
**What goes wrong:** Connection state changes in main process but UI shows stale "connecting" state.
**Why it happens:** IPC event listener not registered or cleaned up improperly.
**How to avoid:** Register `ssh.onStatus` listener in App.tsx alongside notification listeners. Update connectionSlice state on event. Clean up listener on unmount.
**Warning signs:** Status badge stuck on spinner; requires app restart to update.

### Pitfall 4: Settings Section Doesn't Reflect Profile Changes
**What goes wrong:** User adds SSH profile in settings but it doesn't appear in context switcher.
**Why it happens:** Settings section modifies ConfigManager, but contextSlice doesn't refetch available contexts.
**How to avoid:** After profile save, call `context.list()` IPC to refresh available contexts. Or: add `config.onUpdated` listener in contextSlice to auto-refresh when ssh.profiles changes.
**Warning signs:** Profile appears in settings but not in switcher dropdown until app restart.

### Pitfall 5: Keyboard Shortcut Collision with Existing Shortcuts
**What goes wrong:** Cmd+K already opens CommandPalette; using it for context switch breaks search.
**Why it happens:** useKeyboardShortcuts processes shortcuts in order; first match wins.
**How to avoid:** Use Cmd+Shift+K (or Cmd+Option+K) for context switching. Document in UI (tooltip, settings help text).
**Warning signs:** CommandPalette no longer opens on Cmd+K after adding context switch shortcut.

## Code Examples

Verified patterns from codebase:

### Dropdown Component Pattern (from SidebarHeader.tsx)
```typescript
// Source: src/renderer/components/layout/SidebarHeader.tsx lines 236-295
const [isDropdownOpen, setIsDropdownOpen] = useState(false);
const dropdownRef = useRef<HTMLDivElement>(null);

// Close dropdowns on outside click
useEffect(() => {
  function handleClickOutside(event: MouseEvent): void {
    if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
      setIsDropdownOpen(false);
    }
  }
  document.addEventListener('mousedown', handleClickOutside);
  return () => document.removeEventListener('mousedown', handleClickOutside);
}, []);

// Close on escape
useEffect(() => {
  function handleEscape(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      setIsDropdownOpen(false);
    }
  }
  document.addEventListener('keydown', handleEscape);
  return () => document.removeEventListener('keydown', handleEscape);
}, []);
```

### Connection Status Indicator Pattern (from ConnectionSection.tsx)
```typescript
// Source: src/renderer/components/settings/sections/ConnectionSection.tsx lines 150-178
{isConnected && (
  <div
    className="flex items-center gap-3 rounded-md border px-4 py-3"
    style={{
      borderColor: 'rgba(34, 197, 94, 0.3)',
      backgroundColor: 'rgba(34, 197, 94, 0.05)',
    }}
  >
    <Wifi className="size-4 text-green-400" />
    <div className="flex-1">
      <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
        Connected to {connectedHost}
      </p>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        Viewing remote sessions via SSH
      </p>
    </div>
  </div>
)}
```

### Keyboard Shortcut Pattern (from useKeyboardShortcuts.ts)
```typescript
// Source: src/renderer/hooks/useKeyboardShortcuts.ts lines 68-97
useEffect(() => {
  function handleKeyDown(event: KeyboardEvent): void {
    const isMod = event.metaKey || event.ctrlKey;

    if (!isMod) return;

    // Cmd+K: Open command palette
    if (event.key === 'k') {
      event.preventDefault();
      openCommandPalette();
      return;
    }

    // Add context switcher shortcut here
    // Cmd+Shift+K: Open context switcher or cycle contexts
    if (event.key === 'k' && event.shiftKey) {
      event.preventDefault();
      // Implementation here
      return;
    }
  }

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [dependencies]);
```

### IPC Event Listener Pattern (from App.tsx and store initialization)
```typescript
// Source: src/renderer/App.tsx lines 22-31
// Initialize IPC event listeners (notifications, file changes)
useEffect(() => {
  const cleanup = initializeNotificationListeners();
  return cleanup;
}, []);

// Add SSH status listener similarly
useEffect(() => {
  const unsubscribe = window.electronAPI.ssh.onStatus((event, status) => {
    useStore.getState().setConnectionStatus(
      status.state,
      status.host,
      status.error
    );
  });
  return unsubscribe;
}, []);
```

### Settings CRUD Pattern (from NotificationTriggerSettings)
```typescript
// Source: src/renderer/components/settings/NotificationTriggerSettings/index.tsx
const handleAddProfile = async (profile: Omit<SshConnectionProfile, 'id'>) => {
  const newProfile = { ...profile, id: generateId() };
  await window.electronAPI.config.update('ssh', {
    profiles: [...profiles, newProfile]
  });
  await loadProfiles(); // Refetch from config
};

const handleDeleteProfile = async (id: string) => {
  await window.electronAPI.config.update('ssh', {
    profiles: profiles.filter(p => p.id !== id)
  });
  await loadProfiles();
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual SSH connection in terminal, copy session files | In-app SSH connection with file watcher | Phase 2 (completed) | Users can now connect to remote machines without leaving app |
| No workspace concept, single active project | Multi-workspace with snapshot/restore | Phase 3 (completed) | Users can switch between local and remote without losing UI state |
| Status indicators only in settings view | Persistent status in sidebar/status bar | This phase (04) | Users always know which workspace is active without navigating to settings |

**Deprecated/outdated:**
- N/A — This is a greenfield feature building on new infrastructure.

## Open Questions

1. **Context switcher placement in SidebarHeader Row 1**
   - What we know: Row 1 has project name (left) and collapse button (right). Project name is clickable dropdown.
   - What's unclear: Should context switcher be separate button left of project name, or integrated into project dropdown?
   - Recommendation: Separate button left of project name (before traffic light padding). This keeps "where am I" (workspace) distinct from "what am I viewing" (project). VS Code model supports this (Remote indicator is separate from workspace name).

2. **Keyboard shortcut choice**
   - What we know: Cmd+K is CommandPalette. Requirements specify "Cmd/Ctrl+K or similar" for switching.
   - What's unclear: Should Cmd+Shift+K open switcher dropdown, or directly cycle to next context?
   - Recommendation: Cmd+Shift+K cycles to next context (faster for power users with 2-3 contexts). Cmd+Option+K opens dropdown (for users with many SSH profiles). Document both.

3. **SSH profile quick-connect in switcher**
   - What we know: SSH profiles stored in config can be saved/edited/deleted in settings.
   - What's unclear: Should context switcher dropdown show saved profiles (allowing one-click connect), or only show currently active contexts?
   - Recommendation: Show active contexts only (Local + currently connected SSH). Use settings section for profile management and initial connection. This keeps switcher simple (switch between established contexts) vs. connection manager (complex).

4. **Connection failure handling in switcher**
   - What we know: Switching to SSH context can fail (network error, auth failure).
   - What's unclear: Should switcher show error inline, or defer to toast notification?
   - Recommendation: Show inline error in dropdown (similar to ConnectionSection error display lines 180-184). User attempted action in switcher, error should appear there. Toast would be easy to miss.

## Sources

### Primary (HIGH confidence)
- Existing codebase patterns:
  - `/home/bskim/claude-devtools/src/renderer/components/layout/SidebarHeader.tsx` - Dropdown pattern, macOS traffic light handling
  - `/home/bskim/claude-devtools/src/renderer/components/settings/sections/ConnectionSection.tsx` - Connection status display, SSH config
  - `/home/bskim/claude-devtools/src/renderer/hooks/useKeyboardShortcuts.ts` - Keyboard shortcut registration pattern
  - `/home/bskim/claude-devtools/src/renderer/components/common/ContextSwitchOverlay.tsx` - Context switching overlay (already implemented)
  - `/home/bskim/claude-devtools/src/renderer/store/slices/contextSlice.ts` - Context switching state management
  - `/home/bskim/claude-devtools/src/renderer/store/slices/connectionSlice.ts` - SSH connection state management

### Secondary (MEDIUM confidence)
- [VS Code Status Bar UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/status-bar) - Official VS Code extension API docs specifying status bar item placement (workspace items on left)
- [Electron Keyboard Shortcuts Documentation](https://www.electronjs.org/docs/latest/tutorial/keyboard-shortcuts) - Official Electron docs for keyboard shortcut implementation
- [Headless UI Listbox Documentation](https://headlessui.com/react/listbox) - Keyboard navigation and accessibility patterns for dropdowns
- [Radix UI Dropdown Menu Documentation](https://www.radix-ui.com/primitives/docs/components/dropdown-menu) - WAI-ARIA compliant dropdown patterns
- [DoltHub: Building a Custom Title Bar in Electron](https://www.dolthub.com/blog/2025-02-11-building-a-custom-title-bar-in-electron/) - Recent (Feb 2025) article on Electron title bar patterns with dropdowns

### Tertiary (LOW confidence)
- N/A — No unverified claims requiring low-confidence flagging.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use, verified in package.json and codebase
- Architecture patterns: HIGH - Patterns extracted directly from existing components (SidebarHeader, ConnectionSection, useKeyboardShortcuts)
- Don't hand-roll recommendations: HIGH - Based on existing infrastructure from Phases 1-3
- Pitfalls: MEDIUM-HIGH - Based on common React/Electron patterns and analysis of existing code; actual pitfalls will emerge during implementation

**Research date:** 2026-02-12
**Valid until:** ~30 days (March 2026) - UI patterns are stable, but Electron/React ecosystem updates could introduce new best practices
