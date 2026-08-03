#!/bin/sh
set -eu

if [ "$#" -lt 2 ]; then
  echo "Usage: npm run task:start -- <TASK-ID> <task title>" >&2
  exit 1
fi

task_id=$1
shift
title=$*

case "$task_id" in
  [A-Z][A-Z0-9]*-[0-9]*) ;;
  *)
    echo "Invalid task ID '$task_id' (expected e.g. FUC-16)." >&2
    exit 1
    ;;
esac

if [ -n "$(git status --porcelain)" ]; then
  echo "Cannot start a task with uncommitted changes." >&2
  exit 1
fi

slug=$(printf '%s' "$title" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')
git switch -c "task/${task_id}-${slug}"
echo "Started task ${task_id} on task/${task_id}-${slug}."
