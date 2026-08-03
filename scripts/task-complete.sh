#!/bin/sh
set -eu

if [ "$#" -lt 1 ]; then
  echo "Usage: npm run task:complete -- <task title>" >&2
  exit 1
fi

branch=$(git branch --show-current)
case "$branch" in
  task/[A-Z][A-Z0-9]*-[0-9]*-*) ;;
  *)
    echo "Cannot complete a task outside task/<TASK-ID>-<slug>." >&2
    exit 1
    ;;
esac

if [ -z "$(git status --porcelain)" ]; then
  echo "Cannot complete a task without changes." >&2
  exit 1
fi

task_id=$(printf '%s' "$branch" | sed -E 's#^task/([A-Z][A-Z0-9]*-[0-9]+)-.*#\1#')
title=$*

git add --all
git commit -m "${task_id}: ${title} completed"
echo "Completed ${task_id}; review and push commit $(git rev-parse --short HEAD)."
