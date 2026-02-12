# Phase 3: State Management - Research

**Researched:** 2026-02-12
**Domain:** Frontend state persistence and snapshot/restore patterns for multi-context workspace switching
**Confidence:** HIGH

## Summary

Phase 3 implements snapshot-based state management to enable instant context switching between local and SSH workspaces. The core challenge is capturing complete Zustand state (12 slices totaling ~20+ state properties), persisting snapshots to IndexedDB, and restoring them without flickering or stale data flash. This requires: (1) a contextSlice managing the snapshot/restore lifecycle, (2) IndexedDB persistence with TTL-based expiration, (3) validation logic to ensure restored state references valid data (e.g., projectIds exist in current context), and (4) loading overlays to prevent UI flicker during transition.

The research validates that Zustand's architecture supports manual snapshot/restore via `getState()`/`setState()`, IndexedDB provides the storage layer (with third-party TTL libraries for expiration), and React Suspense-style loading overlays prevent stale data flash. The key architectural pattern is **snapshot-on-exit + validate-on-restore**: capture full state when switching away from a context, persist to IndexedDB, then restore and validate when switching back.

**Primary recommendation:** Use Zustand's native snapshot/restore with `idb-keyval` for IndexedDB storage, implement custom TTL tracking (simpler than external library), validate restored tabs/selections against current context data, and show full-screen loading overlay during context switch to prevent any visual artifacts.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Zustand | 4.x (installed) | State management | Already used app-wide; `getState()`/`setState()` enable manual snapshot/restore |
| idb-keyval | Latest (5.x) | IndexedDB wrapper | Official recommendation from Zustand docs for async storage; minimal API (get/set/del) |
| React 18 | 18.x (installed) | UI framework | Suspense/transition APIs enable loading states without flicker |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zustand-indexeddb | 0.1.1 | IndexedDB integration via persist middleware | NOT RECOMMENDED - designed for persist() middleware which auto-hydrates; we need manual control for context switching |
| ttl-db | Latest | TTL support for IndexedDB | NOT NEEDED - manual TTL tracking is simpler for this use case (single timestamp per snapshot) |
| zustand/middleware persist | Built-in | Auto-persist state | NOT SUITABLE - auto-hydrates on app start; we need per-context snapshots with manual restore |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual snapshot/restore | Zustand persist middleware | Persist middleware auto-hydrates into a single global state; we need isolated per-context snapshots with manual restoration |
| idb-keyval | localForage | localForage is heavier (~5KB vs ~600B), adds async wrapper complexity we don't need |
| Custom TTL tracking | ttl-db library | ttl-db adds dependency for lazy expiration (checked on read); we need eager cleanup (background interval) to free IndexedDB space |

**Installation:**
```bash
pnpm add idb-keyval
```

## Architecture Patterns

### Recommended Project Structure

```
src/renderer/
├── store/
│   └── slices/
│       └── contextSlice.ts        # New: snapshot/restore orchestration
├── services/
│   └── contextStorage.ts          # New: IndexedDB persistence layer
├── hooks/
│   └── useContextSwitch.ts        # New: hook for triggering context switches
└── components/
    └── common/
        └── ContextSwitchOverlay.tsx  # New: full-screen loading overlay
```

### Pattern 1: Manual Snapshot/Restore (NOT persist middleware)

**What:** Use Zustand's `getState()` to capture state snapshot, store in IndexedDB, then restore via `setState()` on context switch.

**When to use:** When you need isolated state snapshots per context with manual control over when to capture/restore. NOT when you want auto-hydration on app start (that's what persist middleware does).

**Example:**
```typescript
// Capture snapshot
const captureSnapshot = (contextId: string) => {
  const state = useStore.getState();

  // Extract persistable slices (exclude transient state)
  const snapshot = {
    projects: state.projects,
    selectedProjectId: state.selectedProjectId,
    sessions: state.sessions,
    selectedSessionId: state.selectedSessionId,
    openTabs: state.openTabs,
    activeTabId: state.activeTabId,
    paneLayout: state.paneLayout,
    notifications: state.notifications,
    // ... all other slices
    _metadata: {
      contextId,
      capturedAt: Date.now(),
      version: 1  // for future migrations
    }
  };

  await contextStorage.saveSnapshot(contextId, snapshot);
};

// Restore snapshot
const restoreSnapshot = async (contextId: string) => {
  const snapshot = await contextStorage.loadSnapshot(contextId);
  if (!snapshot) return false; // Never visited this context

  // Validate snapshot against current context data
  const validated = validateSnapshot(snapshot);

  // Restore via setState
  useStore.setState(validated);
  return true;
};
```

**Why manual over persist middleware:**
- Persist middleware auto-hydrates on app init (single global state)
- We need **per-context** snapshots with **manual** restore on switch
- Switching to "never-visited" context must show empty state, not auto-hydrate from IndexedDB

### Pattern 2: IndexedDB Storage Layer with TTL

**What:** Wrapper around `idb-keyval` that stores snapshots with timestamps and provides TTL-based cleanup.

**When to use:** When persisting context snapshots with expiration to prevent unbounded IndexedDB growth.

**Example:**
```typescript
// src/renderer/services/contextStorage.ts
import { get, set, del, keys } from 'idb-keyval';

interface StoredSnapshot {
  snapshot: StateSnapshot;
  timestamp: number;
  version: number;
}

const SNAPSHOT_TTL_MS = 5 * 60 * 1000; // 5 minutes (from phase notes)
const STORAGE_KEY_PREFIX = 'context-snapshot:';

export const contextStorage = {
  async saveSnapshot(contextId: string, snapshot: StateSnapshot): Promise<void> {
    const stored: StoredSnapshot = {
      snapshot,
      timestamp: Date.now(),
      version: 1
    };
    await set(`${STORAGE_KEY_PREFIX}${contextId}`, stored);
  },

  async loadSnapshot(contextId: string): Promise<StateSnapshot | null> {
    const stored = await get<StoredSnapshot>(`${STORAGE_KEY_PREFIX}${contextId}`);
    if (!stored) return null;

    // Check TTL
    const age = Date.now() - stored.timestamp;
    if (age > SNAPSHOT_TTL_MS) {
      await del(`${STORAGE_KEY_PREFIX}${contextId}`); // Expired, delete
      return null;
    }

    return stored.snapshot;
  },

  async deleteSnapshot(contextId: string): Promise<void> {
    await del(`${STORAGE_KEY_PREFIX}${contextId}`);
  },

  // Background cleanup - call periodically (e.g., on app init, every 5 min)
  async cleanupExpired(): Promise<void> {
    const allKeys = await keys();
    const now = Date.now();

    for (const key of allKeys) {
      if (typeof key === 'string' && key.startsWith(STORAGE_KEY_PREFIX)) {
        const stored = await get<StoredSnapshot>(key);
        if (stored && (now - stored.timestamp) > SNAPSHOT_TTL_MS) {
          await del(key);
        }
      }
    }
  }
};
```

**Why custom TTL over ttl-db:**
- ttl-db uses lazy expiration (checked on read) - we need eager cleanup to free space
- Simple timestamp comparison is easier to reason about than external library
- Only storing one snapshot per context - not a large-scale key-value use case

### Pattern 3: Snapshot Validation

**What:** Validate restored snapshots to ensure references (projectIds, sessionIds, tabIds) exist in the current context.

**When to use:** Always validate after restoring a snapshot to prevent rendering errors from stale references.

**Example:**
```typescript
// Validate that restored tabs reference projects/sessions that exist in current context
const validateSnapshot = (snapshot: StateSnapshot): StateSnapshot => {
  const currentProjects = useStore.getState().projects; // Freshly fetched for new context
  const validProjectIds = new Set(currentProjects.map(p => p.id));

  // Filter tabs to only those with valid projectIds
  const validTabs = snapshot.openTabs.filter(tab => {
    if (tab.type === 'session' && tab.projectId) {
      return validProjectIds.has(tab.projectId);
    }
    return true; // Keep non-session tabs (e.g., dashboard)
  });

  // Reset activeTabId if it references invalid tab
  let activeTabId = snapshot.activeTabId;
  if (activeTabId && !validTabs.find(t => t.id === activeTabId)) {
    activeTabId = validTabs[0]?.id ?? null;
  }

  // Validate pane layout tabs
  const validatedPanes = snapshot.paneLayout.panes.map(pane => ({
    ...pane,
    tabs: pane.tabs.filter(tab => {
      if (tab.type === 'session' && tab.projectId) {
        return validProjectIds.has(tab.projectId);
      }
      return true;
    }),
    activeTabId: validTabs.find(t => t.id === pane.activeTabId) ? pane.activeTabId : null
  }));

  return {
    ...snapshot,
    openTabs: validTabs,
    activeTabId,
    paneLayout: {
      ...snapshot.paneLayout,
      panes: validatedPanes
    }
  };
};
```

**Why validation is critical:**
- Switching to a different context means different projects/sessions exist
- Restored tabs may reference projectIds that don't exist in the new context
- Without validation: React will error trying to render non-existent data

### Pattern 4: Loading Overlay During Context Switch

**What:** Display full-screen overlay during context switch to prevent stale data flash.

**When to use:** During context switches to mask the snapshot/restore + data refetch sequence.

**Example:**
```typescript
// src/renderer/components/common/ContextSwitchOverlay.tsx
export const ContextSwitchOverlay: React.FC = () => {
  const isSwitching = useStore(state => state.isContextSwitching);
  const targetContext = useStore(state => state.targetContextId);

  if (!isSwitching) return null;

  return (
    <div className="fixed inset-0 bg-surface z-[9999] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="animate-spin h-8 w-8 border-4 border-text border-t-transparent rounded-full" />
        <p className="text-text-secondary">
          Switching to {targetContext === 'local' ? 'Local' : targetContext}...
        </p>
      </div>
    </div>
  );
};

// In App.tsx
return (
  <>
    <ContextSwitchOverlay />
    {/* Rest of app */}
  </>
);
```

**Based on Next.js loading.js pattern:** Show instant loading state while content switches, then remove overlay once restoration completes. See [Loading UI and Streaming - Next.js](https://nextjs.org/docs/app/building-your-application/routing/loading-ui-and-streaming).

### Anti-Patterns to Avoid

- **DON'T use Zustand persist middleware for context snapshots:** Persist middleware auto-hydrates on app init into a single global state. We need per-context snapshots with manual restore on switch.

- **DON'T skip validation after restore:** Restored state may contain references to projects/sessions that don't exist in the new context. Always validate and filter invalid references.

- **DON'T restore without showing loading state:** Users will see stale data flash as the old context's UI renders briefly before restoration completes. Always show full-screen overlay during transition.

- **DON'T store derived/computed state:** Only persist base state. Derived values (e.g., filtered lists, computed counts) should be recomputed from restored base state.

- **DON'T persist transient UI state:** Loading flags, error messages, and other transient state should NOT be persisted. Only persist user-facing data and selections.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IndexedDB wrapper | Custom promise-based IndexedDB code | `idb-keyval` | Handles browser quirks, transaction management, error recovery; battle-tested across browsers |
| State serialization | Custom JSON serialization with special cases | Native `JSON.stringify/parse` | Zustand state is already JSON-serializable (no Maps, Sets, Dates in store) |
| TTL expiration checking | Complex timestamp algebra | Simple `Date.now() - stored.timestamp > TTL_MS` | Single comparison is sufficient; no need for date libraries |
| Loading state coordination | Manual boolean flags and setTimeout | React 18 transitions (optional) | Built-in concurrent rendering prevents UI flicker |

**Key insight:** State persistence is deceptively complex due to:
- **Browser compatibility:** IndexedDB behavior varies across browsers (quota limits, transaction lifetimes, error modes)
- **Race conditions:** Multiple tabs accessing same IndexedDB can cause conflicts
- **Quota limits:** Browsers impose storage limits; need cleanup strategy
- **Serialization edge cases:** Circular references, non-serializable types (functions, symbols)

Using `idb-keyval` eliminates these concerns with a 600-byte library that's maintained by the Dexie.js team (IndexedDB experts).

## Common Pitfalls

### Pitfall 1: Auto-hydration with persist middleware

**What goes wrong:** Using Zustand's persist middleware causes auto-hydration on app init, loading the last-saved snapshot into the global store before the user switches contexts.

**Why it happens:** Persist middleware is designed for single-state persistence (e.g., saving user preferences). It auto-calls `rehydrate()` on store creation.

**How to avoid:** Use manual snapshot/restore with `getState()`/`setState()`. Only call restore when the user explicitly switches to a context.

**Warning signs:**
- UI shows data from a different context on app start
- "Hydration mismatch" errors in console
- State resets unexpectedly after reload

### Pitfall 2: Stale Data Flash During Restore

**What goes wrong:** When restoring a snapshot, the UI briefly shows the previous context's data before the new snapshot applies, causing visual flicker.

**Why it happens:** React re-renders with old state before `setState()` completes. Without a loading overlay, users see the old context's projects/sessions for 50-100ms.

**How to avoid:**
1. Set `isContextSwitching: true` BEFORE calling `setState()`
2. Show full-screen loading overlay while `isContextSwitching` is true
3. Complete restore sequence (snapshot + data refetch)
4. Set `isContextSwitching: false` to remove overlay

**Warning signs:**
- Users report seeing "flickering" or "old data" during context switch
- Tabs briefly show wrong session titles before updating
- Sidebar jumps between different project lists

### Pitfall 3: Invalid References After Restore

**What goes wrong:** Restored tabs reference projectIds or sessionIds that don't exist in the new context, causing React to throw errors or render empty states.

**Why it happens:** Contexts have different projects/sessions. Restoring a snapshot from Context A into Context B means tab.projectId may not exist in Context B's data.

**How to avoid:** Always validate restored state against current context data:
```typescript
const validTabs = snapshot.openTabs.filter(tab => {
  if (tab.type === 'session' && tab.projectId) {
    return currentProjectIds.has(tab.projectId);
  }
  return true;
});
```

**Warning signs:**
- Console errors: "Cannot read property 'name' of undefined"
- Tabs show blank content or "Session not found"
- Sidebar selections don't match visible tabs

### Pitfall 4: IndexedDB Quota Exceeded

**What goes wrong:** Snapshots accumulate in IndexedDB until browser quota is exceeded, causing storage failures.

**Why it happens:** No cleanup strategy for expired snapshots or old SSH contexts that no longer exist.

**How to avoid:**
1. Implement TTL-based expiration (5 minutes per phase notes)
2. Run cleanup on app init and periodically (every 5 minutes)
3. Delete snapshots when SSH context is destroyed
4. Store only essential state (exclude transient loading/error flags)

**Warning signs:**
- "QuotaExceededError" in console
- Snapshots fail to save silently
- IndexedDB inspector shows hundreds of old snapshot entries

### Pitfall 5: Restoring Transient State

**What goes wrong:** Loading flags, error messages, and other transient UI state get persisted and restored, causing confusing behavior (e.g., "Loading..." shown on restore).

**Why it happens:** Snapshot captures entire Zustand state including transient flags like `projectsLoading: true`.

**How to avoid:** Use `partialize` pattern to exclude transient state:
```typescript
const snapshot = {
  // Include
  projects: state.projects,
  selectedProjectId: state.selectedProjectId,
  openTabs: state.openTabs,
  // Exclude transient state
  // projectsLoading: false,  // NEVER persist loading flags
  // projectsError: null,     // NEVER persist errors
};
```

**Warning signs:**
- Restored context shows loading spinners that never complete
- Error messages from previous context appear in new context
- UI is "stuck" in loading state after restore

## Code Examples

Verified patterns from official sources:

### Zustand Manual State Capture/Restore

```typescript
// Source: Zustand docs - https://zustand.docs.pmnd.rs/guides/how-to-reset-state
import { useStore } from './store';

// Capture current state
const currentState = useStore.getState();

// Restore state later
useStore.setState({
  projects: restoredProjects,
  selectedProjectId: restoredSelectedProjectId,
  // ... all other slices
}, true); // Second arg `true` = replace entire state (not merge)
```

**Note:** The `replace` parameter (second arg) controls whether to merge or replace. For context switching, use `replace: false` (default) to merge the snapshot with current state, preserving any runtime-only state.

### IndexedDB with idb-keyval

```typescript
// Source: Zustand persist docs - https://zustand.docs.pmnd.rs/integrations/persisting-store-data
import { get, set, del } from 'idb-keyval';

// Save
await set('context-snapshot:local', {
  snapshot: { /* state */ },
  timestamp: Date.now()
});

// Load
const stored = await get('context-snapshot:local');

// Delete
await del('context-snapshot:local');
```

### Context Switch Hook

```typescript
// Pattern based on Zustand actions + async state transitions
export const useContextSwitch = () => {
  const switchContext = useStore(state => state.switchContext);

  const handleSwitch = async (targetContextId: string) => {
    // 1. Show loading overlay
    useStore.setState({ isContextSwitching: true, targetContextId });

    try {
      // 2. Capture current context's snapshot
      const currentContextId = await window.electronAPI.context.getActiveContextId();
      await captureSnapshot(currentContextId);

      // 3. Switch context in main process (updates ServiceContextRegistry)
      await window.electronAPI.context.switch(targetContextId);

      // 4. Try to restore snapshot for target context
      const restored = await restoreSnapshot(targetContextId);

      if (!restored) {
        // Never visited this context - show empty state
        useStore.setState(getEmptyContextState());
      }

      // 5. Fetch fresh data for target context
      await Promise.all([
        useStore.getState().fetchProjects(),
        useStore.getState().fetchRepositoryGroups(),
        useStore.getState().fetchNotifications()
      ]);

      // 6. Hide loading overlay
      useStore.setState({ isContextSwitching: false, targetContextId: null });
    } catch (error) {
      console.error('Context switch failed:', error);
      useStore.setState({
        isContextSwitching: false,
        targetContextId: null,
        // Show error to user
      });
    }
  };

  return { switchContext: handleSwitch };
};
```

### Empty State for New Context

```typescript
// When switching to a never-visited context, reset to empty state
const getEmptyContextState = (): Partial<AppState> => ({
  // Projects
  projects: [],
  selectedProjectId: null,

  // Sessions
  sessions: [],
  selectedSessionId: null,
  sessionsPagination: { hasMore: false, currentPage: 0 },

  // Tabs
  openTabs: [{ type: 'dashboard', id: 'dashboard', label: 'Dashboard' }],
  activeTabId: 'dashboard',

  // Pane layout - single pane with dashboard tab
  paneLayout: {
    panes: [{
      id: 'pane-default',
      tabs: [{ type: 'dashboard', id: 'dashboard', label: 'Dashboard' }],
      activeTabId: 'dashboard',
      selectedTabIds: [],
      widthFraction: 1
    }],
    focusedPaneId: 'pane-default'
  },

  // Notifications
  notifications: [],
  unreadCount: 0,

  // Repository
  repositoryGroups: [],

  // Session detail
  sessionDetail: null,
  sessionChunks: [],
  sessionMetrics: null,

  // Conversation
  conversationGroups: [],

  // Subagent
  subagentDetail: null,
  selectedSubagentId: null,
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| localStorage for state | IndexedDB for state | 2020+ | IndexedDB supports larger quotas (50MB+) and structured data; localStorage limited to 5-10MB strings |
| Redux persist middleware | Zustand manual snapshot | 2021+ | Zustand's simpler API enables custom snapshot/restore without middleware complexity |
| Manual TTL tracking | Libraries like ttl-db | 2023+ | For simple TTL use cases (single timestamp), manual tracking is simpler than library dependency |
| Class components with getDerivedStateFromProps | React 18 Suspense/Transitions | 2022+ | Concurrent rendering prevents UI flicker during async state changes |

**Deprecated/outdated:**
- **localStorage for large state:** Replaced by IndexedDB for quota limits and structured data support
- **Zustand persist middleware for multi-context:** Designed for single-state persistence; manual snapshot/restore needed for per-context isolation
- **react-loading-overlay package:** React 18's Suspense provides built-in loading state coordination

## Open Questions

1. **Snapshot size optimization**
   - What we know: Full Zustand state snapshot includes all 12 slices (projects, sessions, tabs, notifications, etc.)
   - What's unclear: If snapshots exceed 1MB, should we compress (e.g., pako) or partialize more aggressively?
   - Recommendation: Start without compression; monitor snapshot sizes in production. Add compression if snapshots exceed 500KB.

2. **TTL tuning for different contexts**
   - What we know: Phase notes suggest 5-minute TTL based on "typical user switching patterns"
   - What's unclear: Should SSH contexts have longer TTL than local (users might stay in SSH for hours)?
   - Recommendation: Start with uniform 5-minute TTL; add per-context TTL configuration if users report frequent "empty state on switch back" issues.

3. **Graceful degradation when IndexedDB unavailable**
   - What we know: Private browsing modes and some browsers disable IndexedDB
   - What's unclear: Should we fall back to in-memory snapshots or disable persistence entirely?
   - Recommendation: Detect IndexedDB availability on app init; if unavailable, log warning and use in-memory Map for current session only (no persistence across restarts).

4. **Migration strategy for snapshot schema changes**
   - What we know: Zustand persist middleware supports version migrations
   - What's unclear: How to handle breaking changes to snapshot structure in future releases?
   - Recommendation: Include `version` field in stored snapshot; implement migration function that transforms old versions to current schema on load.

## Sources

### Primary (HIGH confidence)

- [Zustand Persist Middleware Documentation](https://zustand.docs.pmnd.rs/integrations/persisting-store-data) - Official docs covering persist middleware, custom storage engines, version migration, and sync vs async storage differences
- [GitHub: zustand-indexeddb](https://github.com/zustandjs/zustand-indexeddb) - Official IndexedDB integration library showing API and limitations
- [GitHub: How can I use zustand persist with indexeddb?](https://github.com/pmndrs/zustand/discussions/1721) - Official discussion confirming idb-keyval as recommended approach
- [Zustand Beginner TypeScript Guide](https://zustand.docs.pmnd.rs/guides/beginner-typescript) - TypeScript patterns for selectors and derived state

### Secondary (MEDIUM confidence)

- [Loading UI and Streaming - Next.js](https://nextjs.org/docs/app/building-your-application/routing/loading-ui-and-streaming) - Pattern for instant loading states during transitions
- [Data Grid - Overlays - MUI X](https://mui.com/x/react-data-grid/overlays/) - Loading overlay patterns for preventing stale data display
- [GitHub: ttl-db](https://github.com/jtsang4/ttl-db) - TTL implementation for IndexedDB showing API and expiration patterns

### Tertiary (LOW confidence)

- [Understanding Zustand: A Lightweight State Management Library](https://blog.msar.me/understanding-zustand-a-lightweight-state-management-library-for-react) - Third-party blog covering derived state patterns
- [Fixing React UI Updates: Stale Data and Caching Issues](https://www.techedubyte.com/react-ui-updates-stale-data-caching-fix/) - Community articles on preventing stale data flash (validate patterns against official docs)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Zustand + idb-keyval confirmed via official docs and recommendations
- Architecture: HIGH - Manual snapshot/restore pattern verified through Zustand docs and community discussions
- Pitfalls: MEDIUM - Common issues identified through GitHub issues and community discussions; validated against official docs

**Research date:** 2026-02-12
**Valid until:** 2026-03-12 (30 days - Zustand is stable, patterns unlikely to change)

**Key findings:**
1. Zustand persist middleware is NOT suitable for per-context snapshots (auto-hydrates single global state)
2. Manual snapshot/restore via `getState()`/`setState()` is the correct pattern for multi-context isolation
3. IndexedDB via `idb-keyval` provides simple async storage with browser compatibility handled
4. Custom TTL tracking (timestamp comparison) is simpler than library dependency for single-snapshot use case
5. Snapshot validation is CRITICAL to prevent rendering errors from stale references
6. Loading overlay during context switch prevents stale data flash (Next.js loading.js pattern)
