# Project Analytics — Feature Overview

**Owner:** proxikal (fork: https://github.com/proxikal/claude-devtools)
**Branch:** `feat/project-analytics` (branch off `feat/spend-dashboard` once that merges)
**Upstream:** matt1398/claude-devtools — **never open a PR without explicit user approval**
**Status:** Phase 4 complete — Phase 5 in progress
**Last Updated:** 2026-02-22

---

## Vision

When a user clicks a project row in the Usage Dashboard, a full analytics panel opens
inside the same tab. No new tab type. No new icon. No changes to Matt's tab system.

The panel shows everything meaningful about that project's Claude usage history:
time-series token activity, model breakdown, session-level detail, and for API users,
real cost data. For Max subscription users, it shows API-equivalent value — how much
compute they extracted vs what they paid. The "value ratio" (e.g. "$8,900 of compute
for $200 in 2 months") is the headline moment that makes this screenshot-worthy.

This is built for power users first. Someone who has run billions of tokens across
hundreds of sessions on a serious project (compiler, framework, etc.) should be able
to understand their usage history at a glance, see their working patterns, and have
data that makes them proud of how much they've built.

Beyond raw numbers, the analytics panel includes a toggleable **Usage Insights** system —
pattern detection applied to your own data that surfaces habits, inefficiencies, and
peak-usage patterns. Not advice from an AI. Just your data, reflected back at you clearly
enough to act on.

---

## What Exists Today

The `feat/spend-dashboard` branch already has a working Usage Dashboard:

- Overview stats (Today / Week / Month / All Time output tokens)
- 14-day activity bar chart
- By Project — ranked by total context tokens, dual bars (output + total)
- By Model — per-model output tokens, accurate multi-model session attribution
- Top Sessions — ranked by total tokens

The infrastructure is clean. This feature builds on top of it without touching
any of its foundational pieces.

---

## Navigate This Folder

| File | What's in it |
|------|-------------|
| [architecture.md](./architecture.md) | Where new files live, what gets modified, and why |
| [data-model.md](./data-model.md) | Types, aggregation logic, caching strategy, subagent rules |
| [panel-layout.md](./panel-layout.md) | What the user actually sees — full mockup |
| [quality-gates.md](./quality-gates.md) | The commands that must pass. Non-negotiable. |
| [agent-handoff.md](./agent-handoff.md) | How to pick up mid-session without making a mess |
| [phases/phase-1-data-pipeline.md](./phases/phase-1-data-pipeline.md) | Build the IPC handler and data aggregation |
| [phases/phase-2-panel-shell.md](./phases/phase-2-panel-shell.md) | Click-to-open panel, back navigation, loading state |
| [phases/phase-3-activity-chart.md](./phases/phase-3-activity-chart.md) | Summary header, activity chart, peak moments |
| [phases/phase-4-model-value.md](./phases/phase-4-model-value.md) | Per-model breakdown + API equivalent value section |
| [phases/phase-5-sessions.md](./phases/phase-5-sessions.md) | Full session list with subagent badges and sort |
| [phases/phase-6-polish.md](./phases/phase-6-polish.md) | Visual polish, empty states, performance, full quality pass |
| [phases/phase-7-insights.md](./phases/phase-7-insights.md) | Usage Insights — pattern detection, habit coaching, toggleable |

---

## Phase Order

Phases must be completed in order. No skipping. No stubbing.

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7
```

Each phase has its own acceptance criteria. A phase is not done until
all quality gates pass and the criteria are met — not "mostly done."

---

## Why This Matters

The existing session viewer shows you *what* Claude did in a session.
This shows you *how* you work — your patterns, your intensity, your investment.

For someone who has run 5+ billion tokens across a serious project in two months,
this isn't analytics. It's a mirror.
