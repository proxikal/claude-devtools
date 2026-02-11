# Claude Code Context

Desktop app for exploring Claude Code session context usage.

It helps you inspect session timelines, search across sessions, debug context injections (`CLAUDE.md`, mentioned files, tool outputs), and configure notification triggers.

## Features
- Repository/worktree-aware project grouping
- Session search with context snippets
- Structured conversation/chunk parsing from Claude JSONL logs
- Context usage inspection (CLAUDE.md + mentioned files + tool output)
- Native notifications with configurable trigger rules
- Real-time updates from Claude session/todo file changes

## Tech Stack
- Electron + electron-vite
- React + TypeScript + Zustand
- Tailwind CSS
- Vitest + ESLint

## Requirements
- Node.js 20+
- pnpm 10+
- macOS or Windows

## Getting Started
```bash
pnpm install
pnpm dev
```

## Data Source
The app reads Claude local data from:
- `~/.claude/projects/`
- `~/.claude/todos/`

## Scripts
```bash
pnpm dev          # Run app in development
pnpm typecheck    # TypeScript checks
pnpm lint         # ESLint (no auto-fix)
pnpm test         # Unit tests
pnpm build        # Electron/Vite production build
pnpm check        # Full local quality gate
pnpm dist:mac     # Package macOS app (electron-builder)
pnpm dist:win     # Package Windows app (electron-builder)
pnpm dist         # Package both targets
```

## Packaging and Release
- Packaging is configured with `electron-builder.yml`.
- CI workflow (`.github/workflows/ci.yml`) runs typecheck/lint/test/build on macOS + Windows.
- Release workflow (`.github/workflows/release.yml`) builds distributables on tags (`v*`).
- Code signing/notarization uses GitHub secrets:
  - `CSC_LINK`, `CSC_KEY_PASSWORD`
  - `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (macOS notarization)

## Security Notes
- IPC handlers validate IDs/inputs and apply strict path containment checks.
- File reads for context injection are constrained to project root and `~/.claude`.
- Sensitive credential path patterns are blocked.

## Contributing
See:
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`

## License
MIT (`LICENSE`)
