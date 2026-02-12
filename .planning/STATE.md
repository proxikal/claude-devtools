# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-12)

**Core value:** Users can seamlessly switch between local and SSH workspaces without losing state, and SSH sessions actually load their conversation history.
**Current focus:** Phase 1 complete — ready for Phase 2

## Current Position

Phase: 4 of 4 (Workspace UI)
Plan: 2 of 2
Status: Phase 04 complete - all phases finished
Last activity: 2026-02-12 - Completed 04-02 (Workspace settings SSH profile CRUD)

Progress: [██████████] 100.0% (4/4 phases)

## Performance Metrics

**Velocity:**
- Total plans completed: 7
- Average duration: 5 min
- Total execution time: 0.68 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 Provider Plumbing | 1 | 4 min | 4 min |
| 02 Service Infrastructure | 3 | 12 min | 4 min |
| 03 State Management | 1 | 7 min | 7 min |
| 04 Workspace UI | 2 | 10 min | 5 min |

**Recent Trend:**
- Last 5 plans: 6, 2, 7, 6, 4
- Trend: Stable (UI tasks executing efficiently with clear patterns)

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- ServiceContextRegistry in main process (centralizes context lifecycle)
- Snapshot/restore for Zustand state (instant switching without refetching)
- Workspace indicators in sidebar + status bar (VS Code model)
- SSH watchers stay alive in background (real-time updates for all workspaces)
- Added getFileSystemProvider() getter to ProjectScanner for consistent provider access (01-01)
- Threaded provider through all parseJsonlFile() call sites instead of relying on optional parameter fallback (01-01)
- Refactored SubagentDetailBuilder to accept fsProvider and projectsDir as explicit parameters (01-01)
- ServiceContext bundles all session-data services for single workspace isolation (02-01)
- dispose() separate from stop() - stop pauses (reversible), dispose destroys (permanent) (02-01)
- removeAllListeners() called LAST in dispose() to prevent events during cleanup (02-01)
- File watcher event rewiring via exported onContextSwitched callback from index.ts (02-02)
- SSH handler dynamically imports onContextSwitched to avoid circular dependencies (02-02)
- Context ID for SSH uses simple format: ssh-{host} (02-02)
- Destroy existing SSH context on reconnection to same host (02-02)
- [Phase 02-03]: SSH profiles stored in ConfigManager config.ssh.profiles for persistence
- [Phase 02-03]: lastActiveContextId persisted in config for app restart restoration
- [Phase 03-01]: 5-minute TTL for snapshot expiration (balances staleness vs utility)
- [Phase 03-01]: Exclude all transient state from snapshots (loading flags, errors, Maps/Sets)
- [Phase 03-01]: Validate restored tabs against fresh project/worktree data from target context
- [Phase 03-01]: Full-screen overlay prevents stale data flash during context transitions
- [Phase 04-01]: ContextSwitcher placed first in SidebarHeader Row 1, before project name, with vertical separator
- [Phase 04-01]: Cmd+Shift+K check placed before Cmd+K to avoid shortcut shadowing
- [Phase 04-01]: SSH status listener refreshes available contexts automatically on connection changes
- [Phase 04-02]: HardDrive icon for Workspaces tab to differentiate from Server icon on Connection tab
- [Phase 04-02]: WorkspaceSection manages own state internally (no props), matching ConnectionSection pattern
- [Phase 04-02]: AppConfig type cast via unknown for ssh field access since AppConfig interface lacks ssh property

### Pending Todos

None yet.

### Blockers/Concerns

**Phase 1:**
- ✓ RESOLVED: SessionParser, SubagentResolver, and SubagentDetailBuilder now receive FileSystemProvider correctly (01-01)
- Need to test SSH session loading and subagent drill-down thoroughly before proceeding to infrastructure changes (deferred to end-to-end testing)

**Phase 2:**
- ServiceContextRegistry pattern is novel for this codebase (no existing examples) - may need proof-of-concept validation
- EventEmitter listener cleanup must be bulletproof - memory leaks from orphaned listeners can consume 50-100MB per switch

**Phase 3:**
- ✓ RESOLVED: 5-minute TTL implemented with configurable version checking (03-01)
- ✓ RESOLVED: Snapshot validation filters invalid tabs and ensures at-least-one-pane invariant (03-01)

**Phase 4:**
- ✓ RESOLVED: Context switcher placed in Row 1 before project name with vertical separator — fits naturally without disrupting layout (04-01)

## Session Continuity

Last session: 2026-02-12
Stopped at: Completed 04-02 (Workspace settings SSH profile CRUD) — All phases complete
Resume file: None

---
*Created: 2026-02-12*
*Last updated: 2026-02-12 after completing 04-02-PLAN.md*
