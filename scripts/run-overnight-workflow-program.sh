#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

export PATH="$HOME/.local/bin:$PATH"
export NODE_PATH="$HOME/Projects/AgentWorkforce/relay/node_modules"

STATE_DIR="$REPO_ROOT/.overnight"
LOG_FILE="$STATE_DIR/overnight.log"
SUMMARY_FILE="$STATE_DIR/overnight-summary.md"
mkdir -p "$STATE_DIR"

log() {
  printf '[overnight] %s\n' "$*" | tee -a "$LOG_FILE"
}

append_summary() {
  printf '%s\n' "$*" >> "$SUMMARY_FILE"
}

run_workflow() {
  local label="$1"
  local workflow_file="$2"
  log "starting $label ($workflow_file)"
  local output
  if output=$(agent-relay run "$workflow_file" 2>&1); then
    printf '%s\n' "$output" | tee -a "$LOG_FILE"
    log "$label completed"
    append_summary "- ✅ $label completed"
    return 0
  else
    printf '%s\n' "$output" | tee -a "$LOG_FILE"
    log "$label failed"
    append_summary "- ❌ $label failed"
    return 1
  fi
}

run_if_present() {
  local label="$1"
  local workflow_file="$2"
  if [[ -f "$workflow_file" ]]; then
    run_workflow "$label" "$workflow_file"
  else
    log "skipping $label; missing $workflow_file"
    append_summary "- ⏭️ $label skipped (missing workflow)"
  fi
}

cleanup_noise() {
  log "cleaning transient package/build noise"
  rm -rf packages/core/dist packages/core/node_modules packages/core/package-lock.json || true
  rm -rf packages/sessions/dist packages/sessions/node_modules packages/sessions/package-lock.json || true
  rm -rf packages/surfaces/dist packages/surfaces/node_modules packages/surfaces/package-lock.json || true
  rm -rf packages/connectivity/dist packages/connectivity/node_modules packages/connectivity/package-lock.json || true
  rm -rf packages/coordination/dist packages/coordination/node_modules packages/coordination/package-lock.json || true
  rm -rf packages/routing/dist packages/routing/node_modules packages/routing/package-lock.json || true
  rm -rf packages/memory/dist packages/memory/node_modules packages/memory/package-lock.json || true
  rm -rf packages/traits/dist packages/traits/node_modules packages/traits/package-lock.json || true
}

write_header() {
  : > "$LOG_FILE"
  cat > "$SUMMARY_FILE" <<EOF
# RelayAssistant Overnight Workflow Summary

Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)

## Results
EOF
}

main() {
  write_header
  cleanup_noise

  append_summary "- ℹ️ Repo: $REPO_ROOT"

  # Safe, known-next workflows only.
  run_if_present "v1 proactive specification" "workflows/specify-v1-proactive.ts" || true
  run_if_present "v1 proactive implementation" "workflows/implement-v1-proactive.ts" || true
  run_if_present "v1 policy specification" "workflows/specify-v1-policy.ts" || true
  run_if_present "v1 policy implementation" "workflows/implement-v1-policy.ts" || true

  cleanup_noise

  append_summary "\nFinished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  log "overnight program complete"
  log "summary written to $SUMMARY_FILE"
}

main "$@"
