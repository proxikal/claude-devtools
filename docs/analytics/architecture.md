# Architecture

## Core Decision

The analytics panel lives inside the Usage tab. Clicking a project row transitions
the dashboard to a project detail view. A back button returns to the overview.
This is a `useState` change in `UsageDashboard.tsx` — `selectedProject | null`.

**Why this approach:**
- Zero changes to Matt's tab system (`tabSlice`, `tabs.ts`, `TabBar`, `SortableTab`)
- Zero new IPC channel patterns — follows the exact same handler structure
- Fully contained in `feat/project-analytics` — Matt can accept or reject it as a unit
- Consistent with how the rest of the app works

---

## New Files (This Feature Creates)

```
src/renderer/components/usage/ProjectAnalyticsPanel.tsx
  — Main panel component. Header, back button, all sections.

src/main/ipc/projectAnalytics.ts
  — IPC handler. 5-minute cache per projectId. Calls analyticsAggregator.

src/shared/types/projectAnalytics.ts
  — All new types: ProjectAnalyticsSummary, DailyBucket, HourlyBucket, etc.

src/main/utils/analyticsAggregator.ts
  — Takes array of per-session results, builds ProjectAnalyticsSummary.
  — Pure function. No I/O. Fully testable.
```

---

## Modified Files (Minimal Touch)

```
src/renderer/components/usage/UsageDashboard.tsx
  — Add selectedProjectId state. Project rows become buttons. Render panel when set.

src/main/ipc/handlers.ts
  — Register the new projectAnalytics handler. One line.

src/preload/index.ts
  — Expose the new IPC method. Follows existing pattern exactly.

src/shared/types/api.ts
  — Add getProjectAnalytics to ElectronAPI interface.

src/renderer/api/httpClient.ts
  — Add stub for standalone mode support (same as other handlers).

src/preload/constants/ipcChannels.ts
  — Add GET_PROJECT_ANALYTICS constant.
```

---

## IPC Pattern (Follow Exactly)

Every IPC call in this app follows the same 5-file pattern. Do not deviate:

1. `ipcChannels.ts` — channel name constant
2. `src/main/ipc/{feature}.ts` — main process handler
3. `handlers.ts` — one-line registration
4. `preload/index.ts` — expose to renderer
5. `src/shared/types/api.ts` + `httpClient.ts` — type the renderer-side call

The existing `usage.ts` handler is the reference implementation. When in doubt, do it
exactly how `usage.ts` does it.

---

## What This Feature Does NOT Touch

- `tabSlice.ts` — no new tab types
- `TabBar.tsx`, `SortableTab.tsx` — untouched
- `tabs.ts` — untouched
- `SessionParser.ts`, `ChunkBuilder.ts` — untouched
- Any existing test files — only new tests get added

If you find yourself modifying any of these, stop and reconsider the approach.
