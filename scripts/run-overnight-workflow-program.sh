#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

export PATH="$HOME/.local/bin:$PATH"
export NODE_PATH="$HOME/Projects/AgentWorkforce/relay/node_modules"

STATE_DIR="$REPO_ROOT/.overnight"
LOG_FILE="$STATE_DIR/overnight.log"
SUMMARY_FILE="$STATE_DIR/overnight-summary.md"
BRANCH_NAME="miya/overnight-relayassistant"
mkdir -p "$STATE_DIR"

log() {
  printf '[overnight] %s\n' "$*" | tee -a "$LOG_FILE"
}

append_summary() {
  printf '%s\n' "$*" >> "$SUMMARY_FILE"
}

cleanup_noise() {
  rm -rf .agent-relay || true
  rm -rf packages/*/dist packages/*/node_modules packages/*/package-lock.json || true
}

ensure_branch() {
  git fetch origin >/dev/null 2>&1 || true
  if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
    git checkout "$BRANCH_NAME"
  else
    git checkout -b "$BRANCH_NAME"
  fi
}

commit_and_push_if_needed() {
  cleanup_noise
  if git diff --quiet && git diff --cached --quiet; then
    log "no git changes to commit"
    return 0
  fi
  git add . ':!.overnight' ':!.agent-relay'
  if git diff --cached --quiet; then
    log "no staged changes after cleanup"
    return 0
  fi
  local message="$1"
  git -c user.name='Miya' -c user.email='miya@openclaw.local' commit -m "$message"
  git push -u origin "$BRANCH_NAME"
  append_summary "- ⬆️ pushed branch update: $message"
}

ensure_pr() {
  if gh pr view "$BRANCH_NAME" >/dev/null 2>&1; then
    return 0
  fi
  gh pr create --base main --head "$BRANCH_NAME" \
    --title "WIP: overnight RelayAssistant workflow progress" \
    --body "Automated overnight progress branch for RelayAssistant SDK workflows. This PR is continuously updated by the overnight workflow executor." || true
}

run_workflow() {
  local label="$1"
  local workflow_file="$2"
  log "starting $label ($workflow_file)"
  local output
  if output=$(agent-relay run "$workflow_file" 2>&1); then
    printf '%s\n' "$output" | tee -a "$LOG_FILE"
    append_summary "- ✅ $label completed"
    commit_and_push_if_needed "chore: overnight progress after $label" || true
    return 0
  else
    printf '%s\n' "$output" | tee -a "$LOG_FILE"
    append_summary "- ❌ $label failed"
    commit_and_push_if_needed "chore: overnight partial progress after failed $label" || true
    return 1
  fi
}

has_file() {
  [[ -f "$1" ]]
}

# helper: workflow is considered complete enough if its review verdict exists
already_reviewed() {
  local verdict="$1"
  [[ -f "$verdict" ]]
}

pick_next_workflow() {
  # Traits already complete if review verdict exists.
  if has_file workflows/implement-v1-traits.ts && ! already_reviewed docs/architecture/v1-traits-package-review-verdict.md; then
    echo "v1 traits implementation|workflows/implement-v1-traits.ts"
    return 0
  fi

  # If policy/proactive are added later, only run when missing their review verdicts.
  if has_file workflows/specify-v1-proactive.ts && ! already_reviewed docs/architecture/v1-proactive-review-verdict.md; then
    echo "v1 proactive specification|workflows/specify-v1-proactive.ts"
    return 0
  fi
  if has_file workflows/implement-v1-proactive.ts && ! already_reviewed docs/architecture/v1-proactive-package-review-verdict.md; then
    echo "v1 proactive implementation|workflows/implement-v1-proactive.ts"
    return 0
  fi
  if has_file workflows/specify-v1-policy.ts && ! already_reviewed docs/architecture/v1-policy-review-verdict.md; then
    echo "v1 policy specification|workflows/specify-v1-policy.ts"
    return 0
  fi
  if has_file workflows/implement-v1-policy.ts && ! already_reviewed docs/architecture/v1-policy-package-review-verdict.md; then
    echo "v1 policy implementation|workflows/implement-v1-policy.ts"
    return 0
  fi

  # Future consensus track.
  if has_file workflows/specify-consensus-protocols.ts && ! already_reviewed docs/architecture/consensus-review-verdict.md; then
    echo "consensus protocols specification|workflows/specify-consensus-protocols.ts"
    return 0
  fi

  return 1
}

write_header() {
  : > "$LOG_FILE"
  cat > "$SUMMARY_FILE" <<EOF
# RelayAssistant Overnight Workflow Summary

Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Branch: $BRANCH_NAME

## Results
EOF
}

main() {
  write_header
  ensure_branch
  ensure_pr
  cleanup_noise

  append_summary "- ℹ️ Repo: $REPO_ROOT"

  local iterations=0
  local ran_any=0
  while (( iterations < 8 )); do
    iterations=$((iterations + 1))
    if next=$(pick_next_workflow); then
      ran_any=1
      label=${next%%|*}
      workflow=${next#*|}
      run_workflow "$label" "$workflow" || true
    else
      append_summary "- ⏹️ no eligible next workflow found; stopping safely"
      break
    fi
  done

  if (( ran_any == 0 )); then
    log "no eligible workflows found under current state rules"
  fi

  cleanup_noise
  commit_and_push_if_needed "chore: overnight final cleanup" || true

  append_summary "\nFinished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  log "overnight program complete"
}

main "$@"
