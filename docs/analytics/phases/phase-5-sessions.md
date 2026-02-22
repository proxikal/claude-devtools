# Phase 5 — Sessions List

**Goal:** Full session list with subagent badges, sortable, paginated with show-all.

---

## What to Build

1. **Session rows**
   - Timestamp (date + time, 12-hour format with am/pm, locale: 'en-US')
   - Model badge (same style as used elsewhere in the app)
   - Output tokens (formatted: K, M, B)
   - Total tokens (formatted: K, M, B)
   - First message preview (truncated to ~120 chars, ellipsis if cut)
   - Subagent badge on sessions where `isSubagent: true`

2. **Sort options** (client-side, no refetch)
   - Total tokens — default
   - Date (newest first)
   - Output tokens

3. **Pagination**
   - Default: show 10 sessions
   - "Show all N sessions" expands the list fully
   - No virtualization needed (225 rows is fine as a flat list)

---

## Subagent Detection

The `isSubagent` flag comes from `analyzeSessionTimeSeriesData()` in Phase 1.
Detection: `isSidechain: true` in the first parsed entry of the JSONL.

The badge should be subtle — a small label next to the session, not a full row style change.
It should be identifiable at a glance without drawing too much attention.

---

## Notes

- Clicking a session row does nothing in this phase. (Future work: deep-link to the session.)
- The first message preview strips markdown formatting for readability — plain text only.
- If a session has no user messages (subagent-only), show "—" in the preview column.
- Sessions are already sorted in `ProjectAnalyticsSummary.sessions` by total tokens (default).
  Client-side sort just reorders the array.

---

## Acceptance Criteria

- Session list matches what the main sidebar would show for that project
- Subagent detection accurate — verify against a project known to have subagent sessions
- All three sort options work correctly
- Show 10 / Show all toggle works
- No crashes on projects with 0 sessions, 1 session, or 200+ sessions
- `pnpm typecheck` clean, `pnpm test` all passing
