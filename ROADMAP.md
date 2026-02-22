# Roadmap

Personal feature roadmap for claude-devtools enhancements.

---

## Shipped

### Task Summary Panel — `feat/task-summary`
Collapsible summary row at the bottom of every completed AI group with tool activity.

- Tool pills grouped by name with counts and error indicators
- Subagent rows with type label, tool count, duration, and token count
- Footer with total duration and aggregated token count
- Per-tab expansion state via `tabUISlice` (matches existing patterns)
- Hidden during ongoing sessions
- Zero API calls — fully deterministic from existing parsed data

---

## Planned

### 1. Spend / Cost Dashboard
**Priority: High** — Most impactful for a power user running Claude all day.

The per-session `costUsd` is already in `SessionMetrics`. Just needs aggregation and a surface.

- Daily and weekly spend totals
- Cost per session and per project
- Running total visible from the sidebar or header
- Optional budget threshold alerts via the existing notification system

---

### 2. Cross-Session Search
**Priority: High** — Your history is your most valuable asset. Right now sessions older than a few days are effectively dark.

- Search across all session content (tool outputs, AI responses, file paths, error messages)
- Filter by project, date range, tool type
- Jump directly into the matching session at the right turn
- Builds on the existing `searchSessions` IPC and `SessionSearcher` service

---

### 3. Compact Event Impact Display
**Priority: Medium** — Compaction is a critical moment in long sessions and currently under-communicated.

- Show token delta at each compaction boundary (how much context was dropped)
- Indicate quality of the compact summary (length, coverage)
- Highlight when a session compacted mid-task so you know why behavior changed
- The `CompactBoundary` component and `CompactionTokenDelta` type already exist — needs richer display

---

### 4. Keyboard-First Navigation Audit
**Priority: Medium** — Friction that compounds across hundreds of sessions per week.

- Full keyboard nav for session list, tab switching, group expansion, error jumping
- Keyboard shortcut to open context panel, task summary, notifications
- Audit existing `useKeyboardShortcuts` hook for gaps
- Document all shortcuts in a discoverable help overlay

---

### 5. Session Analytics
**Priority: Low** — Interesting but not blocking daily workflow.

- Aggregate view: sessions per day/week, total tokens by project, average duration
- Most-used tools across all sessions
- Compaction frequency by project (signals which workflows are too long)
- Peak usage hours
- All data is local — no external service needed
