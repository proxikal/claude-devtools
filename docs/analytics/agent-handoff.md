# Agent Handoff — Picking Up Mid-Session

If you are resuming work on this feature, follow these steps before writing a single line.

---

## Step 1: Orient

```bash
git branch --show-current
git log --oneline -10
pnpm typecheck && pnpm test
```

The branch should be `feat/project-analytics`. If it's not, stop and ask.
Typecheck and tests must be clean before you start. If they're not, fix them first.

---

## Step 2: Find the Current Phase

Check which files exist to determine where work stopped:

| File exists? | Means |
|---|---|
| `src/shared/types/projectAnalytics.ts` | Phase 1 started |
| `src/main/ipc/projectAnalytics.ts` | Phase 1 in progress or done |
| `src/renderer/components/usage/ProjectAnalyticsPanel.tsx` | Phase 2+ started |
| Panel renders live data (activity chart visible) | Phase 3+ done |
| Model breakdown + value section visible | Phase 4+ done |
| Sessions list visible | Phase 5+ done |
| `test/main/utils/analyticsAggregator.test.ts` exists and passes | Phase 1 complete |

Then read the acceptance criteria for the current phase before doing anything else.
Phase files are in `docs/analytics/phases/`.

---

## Step 3: Read Before You Touch

Before modifying any file, read it. Before adding to any type, read the existing type.
Before writing a new function, check if `jsonl.ts` or `usageEstimator.ts` already has
something close. Do not duplicate logic that already exists.

Key files to understand before starting Phase 1:
- `src/main/ipc/usage.ts` — the reference IPC handler, follow this exactly
- `src/main/utils/jsonl.ts` — where the new parsing function goes
- `src/shared/types/usage.ts` — the existing types this feature builds on

---

## Branch Strategy

```
main (local + fork/main)
  └── feat/spend-dashboard        ← must merge to main before analytics starts
        └── feat/project-analytics ← this feature
```

When `feat/spend-dashboard` merges to local main, rebase `feat/project-analytics`:

```bash
git checkout feat/project-analytics
git rebase main
```

Resolve any conflicts. Run quality gates. Then continue.

---

## What You Must Never Do

- Open a PR to matt1398/claude-devtools without explicit user instruction
- Force push to main
- Use `--publish` with electron-builder
- Skip quality gates
- Stub a function and move to the next phase ("I'll implement this later")
- Start Phase N+1 before Phase N passes all acceptance criteria
- Modify `tabSlice.ts`, `TabBar.tsx`, `SortableTab.tsx`, or `tabs.ts`

---

## Update the Status

When you complete a phase, update the **Status** line in `docs/analytics/README.md`:

```
Status: Phase 3 complete — Phase 4 in progress
```

This keeps the next agent (or next session) oriented immediately.
