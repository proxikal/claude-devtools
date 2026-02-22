---
name: devtools:store-architecture
description: Zustand store — slices, per-tab vs global state, fetchSessionDetail flow, live refresh, and critical data-flow gotchas. Use when working on store slices, tabSessionData, session loading, or live-update behavior.
---

# Store Architecture

## Slice Map (12 slices — `src/renderer/store/slices/`)

| Slice | Key State | Key Actions |
|-------|-----------|-------------|
| `projectSlice` | `projects[]`, `selectedProjectId` | `selectProject`, `fetchProjects` |
| `repositorySlice` | `repositories[]`, `selectedRepositoryId` | `selectRepository` |
| `sessionSlice` | `sessions[]`, `selectedSessionId` | `selectSession`, `fetchSessionsInitial` |
| `sessionDetailSlice` | `conversation`, `sessionDetail`, `conversationLoading` | `fetchSessionDetail`, `refreshSessionInPlace` |
| `tabSlice` | `openTabs[]`, `activeTabId`, `paneLayout` | `openTab`, `setActiveTab`, `navigateToSession` |
| `tabUISlice` | `tabUIStates: Map<tabId, TabUIState>` | `saveScrollPosition`, `expandAIGroupForTab` |
| `paneSlice` | `paneLayout` | `splitPane`, `closePane` |
| `uiSlice` | `sidebarCollapsed`, `commandPaletteOpen` | `toggleSidebar` |
| `configSlice` | `appConfig: AppConfig \| null` | `loadConfig`, `updateConfig` |
| `notificationSlice` | `notifications[]`, `unreadCount` | `navigateToError` |
| `conversationSlice` | (legacy, mostly superseded by tabSessionData) | — |
| `subagentSlice` | `selectedSubagentId` | `fetchSubagentDetail` |

## Per-Tab vs Global State

**Critical pattern**: Data lives in TWO places simultaneously.

```
Global (s.conversation, s.conversationLoading)   ← legacy/compat
Per-tab (s.tabSessionData[tabId].conversation)   ← preferred
```

`ChatHistory.tsx` selects via:
```typescript
const td = tabId ? s.tabSessionData[tabId] : null;
conversation: td?.conversation ?? s.conversation   // per-tab wins, global fallback
conversationLoading: td?.conversationLoading ?? s.conversationLoading
```

**TabUIState** (scroll, expansion, context panel) — per-tab only, never global:
```typescript
tabUIStates: Map<tabId, {
  expandedAIGroupIds: Set<string>
  expandedDisplayItemIds: Map<string, Set<string>>
  expandedSubagentTraceIds: Set<string>
  savedScrollTop?: number
  showContextPanel: boolean
  selectedContextPhase: number | null
}>
```

## `fetchSessionDetail` Flow

```
openTab() → fetchSessionDetail(projectId, sessionId, tabId)
  ├─ set({ conversationLoading: true })           // GLOBAL — React re-renders
  ├─ set({ tabSessionData[tabId]: { conversationLoading: true } })  // PER-TAB
  ├─ await api.getSessionDetail(...)
  ├─ set({ conversation: newConv, conversationLoading: false, ... }) // GLOBAL
  └─ set({ tabSessionData[tabId]: { conversation: newConv, conversationLoading: false } }) // PER-TAB
```

**Gotcha**: Two separate `set()` calls after fetch. React 18 batches them (single render) but order matters — global fires first. Between renders, `td.conversationLoading` can be `true` while `s.conversationLoading` is `false`. Components using the per-tab fallback see `true` until the second `set()`.

**Cached path** (existing tab re-selected):
```typescript
// setActiveTab checks hasCachedData:
set({ conversation: cachedTabData.conversation, conversationLoading: false })  // no fetch
```
→ `conversationLoading` goes directly `false` with no `true` transition.

## `refreshSessionInPlace` (Live Updates)

Called by `scheduleSessionRefresh` (150ms throttle) on file-change events.

```
file change → scheduleSessionRefresh → refreshSessionInPlace(projectId, sessionId)
  ├─ getSessionDetail (no loading spinner — preserves UI state)
  ├─ set({ conversation: newConversation })   // new object reference — triggers useEffect deps
  └─ set({ tabSessionData[tabId]: { conversation: newConversation } })  // all viewing tabs
```

**Key**: Creates a NEW `conversation` reference → any `useEffect([conversation])` fires.
**Key**: Does NOT set `conversationLoading: true` — no unmount/remount of ChatHistory.
**Key**: Preserves `expandedAIGroupIds` and other tab UI state.

## `navigateToSession` Flow

```typescript
// Existing tab → focus + optional search nav (no fetch)
setActiveTab(existingTab.id)

// New tab → open + fetch
openTab({ type: 'session', sessionId, projectId })
fetchSessionDetail(projectId, sessionId, newTabId)
```

## Key Gotchas

- `tabSessionData[tabId]` doesn't exist until `fetchSessionDetail` runs — fallback to global during that window
- `refreshSessionInPlace` skips if session not currently viewed (any pane)
- Auto-expand new AI groups fires from `refreshSessionInPlace` when `appConfig.general.autoExpandAIGroups`
- `tabSlice` is a facade over `paneLayout` — `openTabs`/`activeTabId` are synced from the focused pane
