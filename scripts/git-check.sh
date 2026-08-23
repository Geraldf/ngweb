#!/bin/sh
set -eu

branch=$(git branch --show-current)
case "$branch" in
  feat/*|fix/*|docs/*|refactor/*) ;;
  main|master)
    echo "Changes must not be made directly on '$branch'." >&2
    exit 1
    ;;
  *)
    echo "Invalid branch '$branch'; use feat/, fix/, docs/, or refactor/." >&2
    exit 1
    ;;
esac

echo "Checking branch: $branch"
npm run typecheck
npm run build

echo
git status --short
echo "Checks passed. Review changes with: git diff"
