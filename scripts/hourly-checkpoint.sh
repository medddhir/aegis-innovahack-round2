#!/usr/bin/env bash
set -euo pipefail
message=${1:-"checkpoint: verified hourly development progress"}
if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  echo "No genuine changes found. Do not create an empty checkpoint."
  exit 1
fi
git add -A
git commit -m "$message"
git push origin main
