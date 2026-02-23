# Git & PR Workflow

This project is a fork of `matt1398/claude-devtools`. Follow this workflow for all contributions.

## Remote Setup
- `origin` = user's fork (`proxikal/claude-devtools`)
- `upstream` = source repo (`matt1398/claude-devtools`)

## Creating a PR Branch

**Always branch from upstream/main, not origin/main:**

```bash
git fetch upstream
git checkout -b feat/my-feature upstream/main
# ... make changes ...
git push -u origin feat/my-feature
```

This ensures the PR only contains your changes, not unrelated commits from your fork.

## While Working on a Feature

1. Commit normally to your feature branch
2. Push to origin: `git push origin feat/my-feature`
3. **Do NOT merge to your local main** until upstream accepts the PR

## If You Want the Feature in Your Fork Immediately

If you need the feature in your fork before upstream merges:

1. Merge to your main: `git checkout main && git merge feat/my-feature`
2. **Keep the PR branch rebased** so it stays clean for the PR:
   ```bash
   git checkout feat/my-feature
   git rebase upstream/main
   git push --force-with-lease origin feat/my-feature
   ```

## Syncing Your Fork with Upstream

```bash
git fetch upstream
git checkout main
git merge upstream/main
git push origin main
```

## Before Creating a PR

Always rebase onto latest upstream/main:

```bash
git fetch upstream
git checkout feat/my-feature
git rebase upstream/main
git push --force-with-lease origin feat/my-feature
```

## After Upstream Merges Your PR

Delete the branch locally and remotely:

```bash
git branch -d feat/my-feature
git push origin --delete feat/my-feature
```

## Checking Branch Status

To see if a branch is merged to upstream:
```bash
git fetch upstream
git branch -r --contains <branch> | grep upstream/main
```

## Common Mistakes to Avoid

1. **Branching from origin/main** - Your main may have commits not in upstream, polluting PRs
2. **Merging to main before PR is accepted** - Makes the PR branch stale
3. **Not rebasing before PR** - Creates messy merge commits or conflicts
4. **Force pushing without --force-with-lease** - Can lose collaborator commits

## PR Title Conventions

- `fix:` - Bug fixes
- `feat:` - New features
- `chore:` - Maintenance (deps, CI, etc.)
- `docs:` - Documentation only
- `refactor:` - Code changes that don't add features or fix bugs
