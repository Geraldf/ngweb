# Git change workflow

Every change is isolated on a typed branch and committed with a Conventional Commit message.

## One-time setup

Install the tracked hooks after cloning:

```sh
npm run git:install-hooks
```

The pre-commit hook blocks commits on `main` and `master`, validates branch names, and checks staged whitespace. The commit-message hook enforces the required format and the 72-character limit.

## Start a change

Begin on a clean `main` or `master` branch, then run:

```sh
npm run git:start -- feat "add contact form"
```

This fast-forwards the base branch and creates `feat/add-contact-form`. Valid types are `feat`, `fix`, `docs`, and `refactor`.

## Check a change

Review and verify the work before committing:

```sh
npm run git:check
git diff
```

The check runs type checking and production builds for both workspaces.

## Commit explicit files

Pass the commit message followed by every file that belongs in the commit:

```sh
npm run git:commit -- "feat(contact): add contact form" apps/web/src/contact.tsx
```

The script stages only those paths, checks the staged diff, and commits. Review it afterward with `git show --stat`, then push the branch and open a pull request. Repository branch protection should additionally require pull requests before merging into the default branch.
