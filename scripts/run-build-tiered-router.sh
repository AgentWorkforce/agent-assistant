#!/usr/bin/env bash
# Wrapper for the tiered-router primitive build.
#
# Creates a git worktree off agent-assistant/main, copies the workflow files
# in, installs deps, then runs the master workflow which fans out to:
#   wave 1: types + SingleShotAdapter
#   wave 2: createTieredRunner
#   wave 3: integrate-and-PR
#
# Usage:
#   bash scripts/run-build-tiered-router.sh
#
# Env:
#   REPO  override agent-assistant repo path (defaults to /Users/khaliqgant/Projects/AgentWorkforce/agent-assistant)

set -euo pipefail

REPO="${REPO:-/Users/khaliqgant/Projects/AgentWorkforce/agent-assistant}"
TS="$(date +%Y%m%d%H%M%S)"
BRANCH="harness/tiered-router-${TS}"
WORKTREE="${REPO}-wt-${TS}"

WORKFLOWS=(
  master-build-tiered-router.ts
  build-router-types-and-singleshot.ts
  build-tiered-runner.ts
  integrate-tiered-router-and-pr.ts
)

if [ ! -d "$REPO" ]; then
  echo "Repo not found at $REPO — set REPO env var" >&2
  exit 1
fi

for w in "${WORKFLOWS[@]}"; do
  if [ ! -f "$REPO/workflows/$w" ]; then
    echo "Missing workflow file: $REPO/workflows/$w" >&2
    exit 1
  fi
done

if ! command -v agent-relay >/dev/null; then
  echo "agent-relay CLI not on PATH" >&2
  exit 1
fi

if ! command -v gh >/dev/null; then
  echo "gh CLI not on PATH" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "gh not authenticated — run 'gh auth login' first" >&2
  exit 1
fi

echo "==> Creating worktree: $WORKTREE on branch $BRANCH"
git -C "$REPO" worktree add -b "$BRANCH" "$WORKTREE" main

trap 'echo; echo "==> Wrapper failed. Worktree preserved at $WORKTREE for inspection."; echo "    To remove: git -C $REPO worktree remove --force $WORKTREE && git -C $REPO branch -D $BRANCH"' ERR

echo "==> Copying workflow files into worktree"
mkdir -p "$WORKTREE/workflows"
for w in "${WORKFLOWS[@]}"; do
  cp "$REPO/workflows/$w" "$WORKTREE/workflows/$w"
done

cd "$WORKTREE"

echo "==> Installing deps in worktree (this may take a minute)"
npm install --no-audit --no-fund 2>&1 | tail -10

echo "==> Running master workflow"
agent-relay run workflows/master-build-tiered-router.ts

trap - ERR

echo
echo "==> Done."
echo "    Worktree: $WORKTREE"
echo "    Branch: $BRANCH"
echo "    The integration workflow opened a PR — check 'gh pr view' inside the worktree for the URL."
echo "    Cleanup after merge: git -C $REPO worktree remove $WORKTREE && git -C $REPO branch -d $BRANCH"
