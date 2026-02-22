# Quality Gates

These run before every commit. No exceptions. No "I'll fix it in the next commit."

```bash
pnpm typecheck   # zero errors
pnpm lint        # zero errors (pre-existing warnings are ok, new ones are not)
pnpm test        # all tests passing
pnpm build       # clean production build
```

If any of these fail, fix it before moving on. A phase is not complete until
all four pass cleanly.

---

## Phase-Specific Gates

### Phase 1 (Data Pipeline)
After the aggregator and IPC handler are built, also run:

```bash
vitest run test/main/utils/analyticsAggregator.test.ts
```

Then verify manually: call the IPC handler from the renderer DevTools console
and compare the numbers against a Python/manual count of the raw JSONL.
At least two projects. Numbers must match exactly.

### Phase 6 (Polish)
Before declaring Phase 6 done, run the full quality suite:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Then manually test:
- macOS: open the app, navigate to the panel, check every section
- Verify no `toLocaleString` calls without locale argument (Windows CI will fail)
- Verify no `Intl` usage without guards (same reason)

---

## Windows CI Rule

This codebase has a history of Windows CI failures due to locale-sensitive number
formatting. The fix is simple — always pass a locale argument:

```
toLocaleString('en-US')     ← correct
toLocaleString()            ← will fail on Windows CI
```

Any new number or date formatting code must follow this rule.

---

## What "Zero Errors" Means

TypeScript errors: zero. No `// @ts-ignore`, no `as any` to silence a legitimate error.
If the types are fighting you, fix the types or reconsider the data model.

Lint errors: zero new ones. Pre-existing warnings in unchanged files are not your problem.
New warnings you introduce are.

Tests: all passing. If you broke an existing test, fix it — don't skip it or comment it out.
