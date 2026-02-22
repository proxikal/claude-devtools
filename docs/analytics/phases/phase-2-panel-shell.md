# Phase 2 — Panel Shell

**Goal:** Clicking a project row opens the analytics panel. Back button returns to the
overview. No data rendered yet — loading state only. This phase is purely structural.

---

## What to Build

1. **`src/renderer/components/usage/ProjectAnalyticsPanel.tsx`**
   - Shell component: header with project name and path, back button, loading spinner
   - Calls `getProjectAnalytics(projectId)` on mount
   - Shows loading state while the IPC call is in flight
   - Shows error state if the call fails

2. **`UsageDashboard.tsx` changes**
   - Add `selectedProjectId: string | null` state (useState, local to the component)
   - Project rows become `<button>` elements with `cursor-pointer` and hover highlight
   - On click: set `selectedProjectId`
   - When `selectedProjectId` is set: render `ProjectAnalyticsPanel` instead of the overview
   - Back button in the panel: call `setSelectedProjectId(null)` to return to overview

---

## Notes

- Do not use `useNavigate`, router state, or URL changes for this. It's a local state toggle.
- The overview scroll position does not need to be preserved in this phase.
  (If it bothers you, use a `useRef` to save and restore it — but don't over-engineer.)
- The panel shell does not need to handle keyboard navigation in this phase.

---

## Acceptance Criteria

- Click any project row → panel opens, shows project name/path in header
- Loading spinner visible while IPC call is in flight
- Back button returns to the usage overview
- No visual regressions on the overview (spot check: stats, bars, sessions all still render)
- `pnpm typecheck` clean, `pnpm test` all passing
