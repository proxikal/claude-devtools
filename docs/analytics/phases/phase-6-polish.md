# Phase 6 — Polish + Quality Pass

**Goal:** It looks awe-inspiring, passes all checks, and is ready for review.

---

## What to Do

1. **Visual consistency**
   - Every color uses CSS variables — zero hardcoded hex values
   - Dark and light themes both look correct (toggle with `useTheme`)
   - Typography, spacing, and component sizing match the rest of the app
   - No visual regressions on the overview dashboard

2. **Empty states**
   - New project with 1 session: renders cleanly, no crashes
   - Project with only subagent sessions: all stats accurate, every row badged
   - Project with 0 completed sessions: graceful "no data" state

3. **Performance**
   - Small project (1–10 sessions): panel feels instant
   - Large project (Atlas-scale, 225+ sessions): loads in under 2 seconds
   - No jank when toggling chart time ranges or sorting sessions

4. **Cross-platform**
   - No `toLocaleString()` calls without `'en-US'` locale argument
   - No `Intl` usage without Windows-safe guards
   - Test mentally: would this break on a machine with a non-English locale?

5. **Full quality suite**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Zero errors. Clean build. All tests passing.

---

## The Bar

Before calling this phase done, look at the panel as a whole. Ask:
- Would a contributor see this and think "this is production quality"?
- Would a power user screenshot this and share it?
- Does the value ratio feel like a reveal or a footnote?
- Does the activity chart tell a story about the project's history?

If the answer to any of these is "not quite" — that's the thing to fix.

---

## Acceptance Criteria

- Full quality suite passes clean
- Dark and light themes both look correct
- All empty states render without errors
- Atlas-scale project loads in under 2 seconds
- No Windows CI footguns (toLocaleString, Intl)
- Visual review: looks awe-inspiring
