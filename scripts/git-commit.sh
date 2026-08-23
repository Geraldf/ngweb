#!/bin/sh
set -eu

if [ "$#" -lt 2 ]; then
  echo 'Usage: npm run git:commit -- "type(scope): summary" <file> [file ...]' >&2
  exit 1
fi

message=$1
shift

case "$(git branch --show-current)" in
  main|master)
    echo "Refusing to commit directly to a protected branch." >&2
    exit 1
    ;;
esac

git add -- "$@"

if git diff --cached --quiet; then
  echo "The selected files contain no staged changes." >&2
  exit 1
fi

git diff --cached --check
git diff --cached --stat
git commit -m "$message"
