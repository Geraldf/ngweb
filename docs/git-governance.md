# Git task governance

Every task is isolated on its own branch and ends with a task-specific completion commit.

## Start a task

Begin from a clean base branch, then run:

```sh
npm run task:start -- FUC-17 "Add contact form"
```

This creates `task/FUC-17-add-contact-form`. One task must not share a branch with another task.

## Complete a task

After implementing and verifying the work, run:

```sh
npm run task:complete -- "Add contact form"
```

This stages the task changes and creates `FUC-17: Add contact form completed`. The commit hook rejects commits that are not on a correctly named task branch or do not use the completion-message convention.

## One-time setup

Run `npm run governance:install` after cloning. This configures Git to use the version-controlled hooks in `.githooks`.

The workflow guarantees one branch and at least one completion commit per task in a configured clone. Repository branch protection should additionally require pull requests before merging task branches into the default branch.
