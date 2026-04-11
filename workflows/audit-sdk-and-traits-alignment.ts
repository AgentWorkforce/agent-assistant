const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('relay-agent-assistant-audit-sdk-and-traits-alignment')
    .description('Audit the current relay-agent-assistant state, align docs with implemented reality, add explicit guidance and space for traits/persona, and update workspace guidance where future workflows should stay aligned.')
    .pattern('supervisor')
    .channel('wf-relay-assistant-audit-traits')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead architecture auditor for the assistant SDK, responsible for synthesizing implemented reality, workforce persona context, and assistant-traits guidance into a coherent update pass.',
      retries: 1,
    })
    .agent('author-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Updates relay-agent-assistant docs to reflect implemented state, package reality, reuse-first guidance, and the new traits/persona layer direction.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the audit/alignment results for consistency with implemented code, workforce persona context, and future workflow guidance.',
      retries: 1,
    })

    .step('read-audit-context', {
      type: 'deterministic',
      command: [
        'echo "---README---"',
        'sed -n "1,260p" README.md',
        'echo "" && echo "---PACKAGE BOUNDARY MAP---"',
        'sed -n "1,360p" docs/architecture/package-boundary-map.md',
        'echo "" && echo "---WORKFLOW BACKLOG---"',
        'sed -n "1,360p" docs/workflows/v1-workflow-backlog.md',
        'echo "" && echo "---WEEKEND DELIVERY---"',
        'sed -n "1,320p" docs/workflows/weekend-delivery-plan.md',
        'echo "" && echo "---INTERNAL COMPARISON---"',
        'sed -n "1,360p" docs/research/internal-system-comparison.md',
        'echo "" && echo "---ROUTING REVIEW---"',
        'sed -n "1,260p" docs/architecture/v1-routing-review-verdict.md',
        'echo "" && echo "---COORD ROUTING INTEGRATION REVIEW---"',
        'sed -n "1,260p" docs/architecture/v1-coordination-routing-integration-review-verdict.md',
        'echo "" && echo "---WORKFORCE CONTEXT---"',
        'sed -n "1,260p" ../workforce/README.md',
        'echo "" && echo "---WORKSPACE AGENTS---"',
        'sed -n "1,260p" /Users/khaliqgant/.openclaw/workspace/AGENTS.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-audit-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-audit-context'],
      task: `Using the current SDK docs, implementation review results, workforce context, and workspace guidance below, write a focused audit/alignment plan.

{{steps.read-audit-context.output}}

Write docs/architecture/sdk-audit-and-traits-alignment-plan.md.

The plan must:
1. summarize what is actually implemented vs still only specified
2. define the clearest docs gaps or drift to fix now
3. state how workforce personas relate to assistant traits/persona without collapsing them together
4. define where a future traits layer/package should live in the package map
5. identify any workspace guidance that should be updated so future workflows stay aligned

End the document with SDK_AUDIT_ALIGNMENT_PLAN_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/sdk-audit-and-traits-alignment-plan.md' },
    })

    .step('apply-audit-alignment', {
      agent: 'author-claude',
      dependsOn: ['lead-audit-plan'],
      task: `Apply the audit/alignment updates using docs/architecture/sdk-audit-and-traits-alignment-plan.md.

Update the relay-agent-assistant repo docs so they reflect implemented reality and explicitly make space for traits/persona.

Required outputs/updates:
- README.md
- docs/architecture/package-boundary-map.md
- docs/workflows/v1-workflow-backlog.md
- docs/workflows/weekend-delivery-plan.md
- docs/research/internal-system-comparison.md
- docs/architecture/traits-and-persona-layer.md
- docs/index.md

Also update workspace guidance where appropriate so future workflows remain aligned:
- /Users/khaliqgant/.openclaw/workspace/AGENTS.md
  - only if there is a clearly useful, durable note for future-you about reuse-first investigation or assistant-sdk alignment

Requirements:
- make implemented vs specified status clearer
- explicitly note workforce persona context vs assistant traits/persona layer
- explicitly note that agents should investigate existing Relay/AgentWorkforce packages before building new greenfield packages
- define where traits/persona sits in the architecture
- keep updates practical, not fluffy

IMPORTANT:
- write files to disk
- do not print full docs to stdout
- end docs/architecture/traits-and-persona-layer.md with TRAITS_PERSONA_LAYER_READY`,
      verification: { type: 'file_exists', value: 'docs/architecture/traits-and-persona-layer.md' },
    })

    .step('review-audit-alignment', {
      agent: 'review-codex',
      dependsOn: ['apply-audit-alignment'],
      task: `Review the SDK audit/alignment updates.

Read:
- docs/architecture/sdk-audit-and-traits-alignment-plan.md
- README.md
- docs/architecture/package-boundary-map.md
- docs/workflows/v1-workflow-backlog.md
- docs/workflows/weekend-delivery-plan.md
- docs/research/internal-system-comparison.md
- docs/architecture/traits-and-persona-layer.md
- docs/index.md
- /Users/khaliqgant/.openclaw/workspace/AGENTS.md

Assess:
1. Do the docs now clearly distinguish implemented vs specified packages?
2. Is workforce persona vs assistant traits/persona now explained clearly enough?
3. Is the traits layer given a plausible architectural home?
4. Is the reuse-first guidance clear enough for future workflows?
5. Are the updates practical and aligned with the current codebase state?

Write docs/architecture/sdk-audit-and-traits-alignment-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with SDK_AUDIT_ALIGNMENT_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/sdk-audit-and-traits-alignment-review-verdict.md' },
    })

    .step('verify-audit-alignment-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-audit-alignment'],
      command: [
        'test -f docs/architecture/sdk-audit-and-traits-alignment-plan.md',
        'test -f docs/architecture/traits-and-persona-layer.md',
        'test -f docs/architecture/sdk-audit-and-traits-alignment-review-verdict.md',
        'grep -q "SDK_AUDIT_ALIGNMENT_PLAN_READY" docs/architecture/sdk-audit-and-traits-alignment-plan.md',
        'grep -q "TRAITS_PERSONA_LAYER_READY" docs/architecture/traits-and-persona-layer.md',
        'grep -q "SDK_AUDIT_ALIGNMENT_REVIEW_COMPLETE" docs/architecture/sdk-audit-and-traits-alignment-review-verdict.md',
        'echo "SDK_AUDIT_ALIGNMENT_VERIFIED"',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
