#!/bin/sh
# Prepares a fresh worktree: shares the main checkout's .env and installs
# dependencies (which also enables the pre-commit hook). T3 Code runs this on
# worktree creation via t3.json; run it by hand in any other new worktree.
set -e
root="${T3CODE_PROJECT_ROOT:-$(git worktree list --porcelain | sed -n '1s/^worktree //p')}"
# Leave any existing .env alone, including the main checkout's own.
if [ ! -e .env ] && [ -f "$root/.env" ]; then
  ln -s "$root/.env" .env
fi
npm ci
