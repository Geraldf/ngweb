#!/bin/sh
set -eu

usage() {
  echo "Usage: npm run git:start -- <feat|fix|docs|refactor> <description>" >&2
}

if [ "$#" -lt 2 ]; then
  usage
  exit 1
fi

type=$1
shift

case "$type" in
  feat|fix|docs|refactor) ;;
  *)
    echo "Unsupported branch type '$type'." >&2
    usage
    exit 1
    ;;
esac

branch=$(git branch --show-current)
case "$branch" in
  main|master) ;;
  *)
    echo "Start a change from main or master, not '$branch'." >&2
    exit 1
    ;;
esac

if [ -n "$(git status --porcelain)" ]; then
  echo "Cannot start a change with uncommitted files." >&2
  exit 1
fi

slug=$(printf '%s' "$*" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')
if [ -z "$slug" ]; then
  echo "The description must contain letters or numbers." >&2
  exit 1
fi

git pull --ff-only
git switch -c "$type/$slug"
echo "Started $type/$slug."
