#!/usr/bin/env bash
set -euo pipefail

AA_REPO="$HOME/Projects/AgentWorkforce/relay-agent-assistant"
SAGE_REPO="$HOME/Projects/AgentWorkforce/sage"
RELAY_NODE_MODULES="$HOME/Projects/AgentWorkforce/relay/node_modules"
LOG_DIR="$AA_REPO/.overnight"
LOG_FILE="$LOG_DIR/overnight-continuation-program.log"
SUMMARY_FILE="$LOG_DIR/overnight-continuation-program-summary.md"

mkdir -p "$LOG_DIR"
: > "$LOG_FILE"

run_workflow() {
  local repo="$1"
  local workflow_file="$2"
  local label="$3"

  echo "\n===== START ${label} =====" | tee -a "$LOG_FILE"
  echo "Repo: $repo" | tee -a "$LOG_FILE"
  echo "Workflow: $workflow_file" | tee -a "$LOG_FILE"
  (
    cd "$repo"
    PATH="$HOME/.local/bin:$PATH" NODE_PATH="$RELAY_NODE_MODULES" \
      agent-relay run "$workflow_file"
  ) 2>&1 | tee -a "$LOG_FILE"
  echo "===== END ${label} =====\n" | tee -a "$LOG_FILE"
}

STATUS="SUCCESS"
FAILED_STEP=""
START_TS="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"

if ! run_workflow "$AA_REPO" "workflows/implement-v1-continuation.ts" "agent-assistant continuation implementation"; then
  STATUS="FAILED"
  FAILED_STEP="agent-assistant continuation implementation"
fi

if [ "$STATUS" = "SUCCESS" ]; then
  if ! run_workflow "$SAGE_REPO" "workflows/adoption/16-sage-continuation-contract.ts" "sage continuation contract"; then
    STATUS="FAILED"
    FAILED_STEP="sage continuation contract"
  fi
fi

if [ "$STATUS" = "SUCCESS" ]; then
  if ! run_workflow "$AA_REPO" "workflows/publish-runtime-core-followup.ts" "agent-assistant runtime-core publish follow-up"; then
    STATUS="FAILED"
    FAILED_STEP="agent-assistant runtime-core publish follow-up"
  fi
fi

END_TS="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"

cat > "$SUMMARY_FILE" <<EOF
# Overnight Continuation Program

- **Started:** $START_TS
- **Ended:** $END_TS
- **Status:** $STATUS
EOF

if [ "$STATUS" = "FAILED" ]; then
  cat >> "$SUMMARY_FILE" <<EOF
- **Failed step:** $FAILED_STEP
EOF
fi

cat >> "$SUMMARY_FILE" <<EOF

## Run order
1. \
   Agent Assistant — \
   \
   \
   \
   \
   \
   \
   \
   \
   \
   implement-v1-continuation.ts
2. Sage — workflows/adoption/16-sage-continuation-contract.ts
3. Agent Assistant — workflows/publish-runtime-core-followup.ts

## Log
- $LOG_FILE
EOF

echo "Overnight continuation program complete. Summary: $SUMMARY_FILE"
