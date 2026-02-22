# Future: Per-Session Analysis Report

**Status:** Not started — documented for consideration
**Related upstream issue:** [#61 — Session Analysis Report](https://github.com/matt1398/claude-devtools/issues/61)
**Our comment with context:** [#61 (comment)](https://github.com/matt1398/claude-devtools/issues/61#issuecomment-3941722660)

---

## What This Would Be

A per-session drill-down report that opens from a session row in the Project Analytics
Panel (or possibly from the session viewer toolbar as the issue author proposes).

Where the Project Analytics Panel shows aggregate patterns across all sessions in a
project, this would go deep on a single session — how efficient was it, what tools were
healthy or struggling, where did time go, what would you do differently.

The full proposal is in [issue #61](https://github.com/matt1398/claude-devtools/issues/61).
The author also has a PR (#60) with a working implementation worth reading before
building anything here.

---

## Sections Proposed (from issue #61)

| Section | What It Shows |
|---|---|
| Overview | Duration, total cost, token count, model used, context health |
| Cost Analysis | Total spend, cost per commit, cost per line changed, subagent cost share |
| Token Economics | Input/output/cache breakdown, cache efficiency %, read-to-write ratio |
| Tool Usage | Per-tool call counts, success rates, health assessment per tool |
| Timeline | Active vs idle time, model switches, session pacing |
| Quality Signals | Prompt quality, startup overhead, file read redundancy, test progression |
| Friction Points | Permission denials, retry patterns, thrashing signals |
| Git Activity | Commits, lines changed, files touched |
| Subagents | Subagent count, tokens, duration, cost per subagent |
| Errors | Error breakdown by type |
| Insights | Key takeaways and notable patterns |

---

## Feasibility Against Our Existing Pipeline

### Already Covered (~70% of the report)

These sections use data our JSONL parsing already produces or could produce with
minimal additions to `analyzeSessionTimeSeriesData()`:

- **Overview** — duration, tokens, model, subagent count are all there. Cost = tokens × pricing table.
- **Token Economics** — input / output / cache_read / cache_creation are already tracked per session. Cache efficiency % and read-to-write ratio are pure math.
- **Tool Usage** — we already track `toolCallCount` and `toolFailureCount`. Per-tool breakdown (call count + failure rate per tool name) just needs one more pass reading `tool_use` blocks, which already have a `name` field.
- **Friction Points** — retry patterns are already detected. Permission denials = `is_error` on `bash` results specifically. Thrashing = failure rate + session length heuristic.
- **Subagents** — subagent sessions are already detected and linked. Cost per subagent = token counts × pricing.
- **Errors** — `is_error` detection is in place. Bucketing by error type needs reading the content string.
- **Timeline** — message timestamps are all there. Active vs idle = gap analysis between turns. Model switch sequence is derivable from `modelBreakdown`.
- **Insights / badges** — identical pattern to Phase 7 Usage Insights. Same threshold + severity approach, more signals.

### Needs New Work

- **Git Activity** — cost per commit, lines changed, files touched requires running
  `git log` / `git diff --stat` against the session's `cwd`. Would need a new IPC
  handler. Only works when the session cwd is a git repo. Non-trivial but self-contained.
- **File Read Redundancy** — pure JSONL: detect the same file path read more than once
  in a session. Easy to add.
- **Model Mismatch Detection** — flagging Opus used for a mechanical task (rename, lint,
  format) requires classifying the task type from tool-call patterns or first message
  keywords. Possible but imprecise without more sophisticated heuristics.
- **Prompt Quality / Startup Overhead** — defined loosely in the issue. Would need
  concrete threshold definitions before implementing.

---

## Architecture Notes

The natural home for this is a new function alongside the existing one in `jsonl.ts`:

```
analyzeSessionTimeSeriesData()   ← exists, used by Project Analytics
analyzeSessionDetailData()       ← new, used by per-session report
```

`analyzeSessionDetailData()` would do a single streaming pass and return a richer
`SessionDetailReport` type covering all the sections above. The renderer reads it and
renders the report — no threshold logic in components, same pattern as everything else.

If we add this, it should slot into the Project Analytics sessions list as a click-to-expand
or click-to-open-panel action on each session row — consistent with the existing UX rather
than adding a new toolbar button to the session viewer.

---

## Before Building

Read the author's PR #60 first. If Matt merges it upstream, we should build on top of
that implementation rather than writing a parallel one. If it doesn't get merged, this
is worth doing independently.
