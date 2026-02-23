# PR Branches Ready for Upstream

Last updated: 2026-02-22

These branches are rebased on `upstream/main` and ready to submit as PRs to `matt1398/claude-devtools`.

## Ready for PR

| Branch | Commits | Description |
|--------|---------|-------------|
| `fix/window-drag-region` | 1 | Reliable window drag region in tab bar + scroll-to-bottom improvements |
| `feat/auto-expand-ai-groups-setting` | 1 | Setting to auto-expand AI response groups |
| `feat/auto-expand-tool-calls` | 3 | Per-tool auto-expand settings with configure modal |
| `feat/session-lifecycle-notifications` | 1 | Session lifecycle triggers (start, end, compact) |
| `feat/task-summary` | 1 | Per-AIGroup task summary with tool breakdown |
| `feat/project-analytics` | 33 | Full project analytics panel with usage insights |

## Branch Details

### fix/window-drag-region
- Fixed ~75% drag failure rate on Windows
- Tab bar drag region active regardless of sidebar state
- Tab list capped at 75% width for reliable drag spacer
- Added floating scroll-to-bottom button
- StrictMode-safe auto-scroll implementation

### feat/auto-expand-ai-groups-setting
- Toggle in settings to auto-expand AI response groups
- Auto-expands new AI groups during live session refresh

### feat/auto-expand-tool-calls
- Per-tool type auto-expand settings
- Configure modal for granular control
- Builds on auto-expand-ai-groups-setting

### feat/session-lifecycle-notifications
- `session_start` trigger when new session begins
- `session_end` trigger when agent finishes (includes last text output)
- `compact` trigger when context compaction occurs
- Debounced to fire only when agent is truly done

### feat/task-summary
- Expandable task summary at top of each AI response group
- Tool call breakdown by type with counts
- Subagent metrics (spawned, completed)

### feat/project-analytics
- Full-screen analytics panel per project
- Activity chart with peak moments
- Model breakdown and value ratio
- Sessions list with sort and subagent badges
- Usage insights section with signal tests

## Cleanup Performed (2026-02-22)

### Deleted Branches
- `fix/linux-sandbox-permissions` - Was Matt's branch, not ours
- `fix/windows-ci-locale-timeout` - Already in main
- `feat/spend-dashboard` - Superseded by feat/project-analytics
- Various already-merged branches (pruned stale refs)

### Workflow Improvements
- Added `.claude/rules/git-workflow.md` documenting proper fork PR workflow
- All branches rebased onto `upstream/main` for clean PRs
