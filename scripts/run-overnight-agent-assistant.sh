#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

export PATH="$HOME/.local/bin:$PATH"
export NODE_PATH="$HOME/Projects/AgentWorkforce/relay/node_modules"

LOG_DIR="$REPO_ROOT/.overnight"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/overnight-agent-assistant.log"
SUMMARY_FILE="$LOG_DIR/overnight-agent-assistant-summary.md"

log(){ printf '[overnight] %s\n' "$*" | tee -a "$LOG_FILE"; }
append(){ printf '%s\n' "$*" >> "$SUMMARY_FILE"; }

clean_repo(){
  rm -rf node_modules packages/*/node_modules packages/*/dist .agent-relay .relay || true
  git restore .trajectories 2>/dev/null || true
}

write_header(){
  : > "$LOG_FILE"
  cat > "$SUMMARY_FILE" <<SUM
# Agent Assistant Overnight Summary

Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Repo: $REPO_ROOT

## Actions
SUM
}

run_workflow(){
  local wf="$1"
  log "running $wf"
  if agent-relay run "$wf" 2>&1 | tee -a "$LOG_FILE"; then
    append "- ✅ $wf"
    return 0
  else
    append "- ❌ $wf"
    return 1
  fi
}

commit_if_needed(){
  clean_repo
  if git diff --quiet && git diff --cached --quiet; then
    log "no changes to commit"
    return 0
  fi
  git add . ':!.overnight' || true
  if git diff --cached --quiet; then
    log "nothing staged after cleanup"
    return 0
  fi
  git -c user.name='Miya' -c user.email='miya@openclaw.local' commit -m "$1" || true
  git push origin main || true
}

main(){
  write_header
  clean_repo

  # 1. Finish rename cleanup if still needed.
  if git grep -nE 'RelayAssistant|relay-assistant|@relay-assistant' -- README.md docs packages .github workflows >/dev/null 2>&1; then
    run_workflow workflows/remediate-agent-assistant-sdk-rename.ts || true
    commit_if_needed "docs: continue agent assistant rename cleanup"
  fi

  # 2. Continue publish infrastructure only if workload-router is resolvable locally.
  if npm view @agentworkforce/workload-router version >/dev/null 2>&1; then
    run_workflow workflows/remediate-publish-infrastructure.ts || true
    commit_if_needed "chore: continue publish infrastructure remediation"
  else
    append "- ℹ️ skipped publish remediation because @agentworkforce/workload-router was not resolvable"
  fi

  clean_repo
  append "\nFinished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  log "overnight run complete"
}

main "$@"
