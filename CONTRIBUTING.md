# Contributing

Thanks for contributing to Claude Code Context.

## Prerequisites
- Node.js 20+
- pnpm 10+
- macOS or Windows

## Setup
```bash
pnpm install
pnpm dev
```

## Quality Gates
Before opening a PR, run:
```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Pull Request Guidelines
- Keep changes focused and small.
- Add/adjust tests for behavior changes.
- Update docs when changing public behavior or setup.
- Use clear PR titles and include a short validation checklist.

## Commit Style
- Prefer conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).
- Include rationale in commit body for non-trivial changes.

## Reporting Bugs
Please include:
- OS version
- app version / commit hash
- repro steps
- expected vs actual behavior
- logs/screenshots when possible
