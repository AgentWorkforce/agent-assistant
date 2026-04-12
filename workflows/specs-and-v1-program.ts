const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('agent-assistant-sdk-specs-and-v1-program')
    .description('Turn the strongest agent-assistant-sdk docs into implementation-ready specs, a v1-style package/section plan, and an Agent Relay workflow backlog for weekend execution.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-specs-v1')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead architect who turns the current docs-first repo into implementation-grade specs and a coherent v1 execution program',
      retries: 1,
    })
    .agent('spec-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Authors the first implementation-ready spec documents from the strongest architecture and package docs',
      retries: 1,
    })
    .agent('program-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Authors the v1 sectioning plan and weekend workflow backlog with explicit sequencing',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the specs and v1 plan for implementability, coherence, and workflow-readiness',
      retries: 1,
    })

    .step('read-repo-context', {
      type: 'deterministic',
      command: [
        'echo "---README---"',
        'sed -n "1,260p" README.md',
        'echo "" && echo "---DOCS INDEX---"',
        'sed -n "1,220p" docs/index.md',
        'echo "" && echo "---STABILITY---"',
        'sed -n "1,260p" docs/reference/stability-and-versioning.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('read-architecture-context', {
      type: 'deterministic',
      command: [
        'echo "---BOUNDARY MAP---"',
        'sed -n "1,320p" docs/architecture/package-boundary-map.md',
        'echo "" && echo "---EXTRACTION ROADMAP---"',
        'sed -n "1,320p" docs/architecture/extraction-roadmap.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('read-consumer-context', {
      type: 'deterministic',
      command: [
        'echo "---BUILD AN ASSISTANT---"',
        'sed -n "1,320p" docs/consumer/how-to-build-an-assistant.md',
        'echo "" && echo "---INTERNAL COMPARISON---"',
        'sed -n "1,320p" docs/research/internal-system-comparison.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('read-connectivity-context', {
      type: 'deterministic',
      command: [
        'echo "---CONNECTIVITY SPEC---"',
        'sed -n "1,320p" docs/architecture/connectivity-package-spec.md',
        'echo "" && echo "---CONNECTIVITY VERDICT---"',
        'sed -n "1,320p" docs/architecture/connectivity-review-verdict.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-repo-context', 'read-architecture-context', 'read-consumer-context', 'read-connectivity-context'],
      task: `Use the captured repo context below to define the next transformation of agent-assistant-sdk.

{{steps.read-repo-context.output}}

{{steps.read-architecture-context.output}}

{{steps.read-consumer-context.output}}

{{steps.read-connectivity-context.output}}

Write docs/architecture/spec-program-plan.md.

This plan must:
1. Define how to move from docs -> specs -> workflows -> code
2. Introduce a v1-style sectioning/program model (the user prefers v1 etc. over P0/P10 wording)
3. Pick the first spec documents that should become canonical implementation references this weekend
4. Identify which packages are v1-critical vs follow-on
5. Define the first workflow backlog that should implement the SDK in narrow slices
6. Keep the goal explicit: Sage, MSD, and NightCTO should be able to begin consuming the exportable SDK by the end of the weekend
7. Prioritize routing and connectivity appropriately instead of automatically postponing them to a much later version
8. Keep the plan concise, decisive, and implementation-facing. Do not write a long essay.

IMPORTANT: Write docs/architecture/spec-program-plan.md to disk and exit once complete. End the document with SPEC_PROGRAM_PLAN_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/spec-program-plan.md' },
    })

    .step('author-specs', {
      agent: 'spec-claude',
      dependsOn: ['lead-plan'],
      task: `Using the existing repo docs plus docs/architecture/spec-program-plan.md, author the first set of implementation-ready specs.

Required files:
- docs/specs/v1-core-spec.md
- docs/specs/v1-sessions-spec.md
- docs/specs/v1-memory-spec.md
- docs/specs/v1-surfaces-spec.md
- docs/specs/v1-connectivity-spec.md
- docs/specs/v1-routing-spec.md

Requirements:
- these are implementation-facing specs, not broad architecture essays
- each spec should include responsibilities, non-goals, first interfaces/contracts, package boundaries, dependency rules, open questions, and first implementation slice
- explicitly reflect relay foundation beneath and workforce-informed routing where relevant
- keep OSS vs cloud boundaries clear
- make the docs strong enough to directly feed future agent-relay implementation workflows

IMPORTANT: create the docs/specs directory if it does not exist, write files to disk, and exit once complete. Do not print full docs to stdout. End each spec file with SPEC_READY.`,
      verification: { type: 'file_exists', value: 'docs/specs/v1-connectivity-spec.md' },
    })

    .step('author-v1-program', {
      agent: 'program-claude',
      dependsOn: ['lead-plan'],
      task: `Using the existing repo docs plus docs/architecture/spec-program-plan.md, author the v1 execution program and workflow backlog.

Required files:
- docs/architecture/v1-sectioning-and-priorities.md
- docs/workflows/v1-workflow-backlog.md
- docs/workflows/weekend-delivery-plan.md

Requirements:
- use v1-style sectioning language rather than P0/P10
- define what is v1.1, v1.2, etc. if helpful
- make the weekend path concrete for Sage, MSD, and NightCTO adoption
- include the first implementation workflows that should be written next
- prefer narrow, PR-sized workflow slices
- show dependencies and likely execution order

IMPORTANT: create the docs/workflows directory if it does not exist, write files to disk, and exit once complete. Do not print full docs to stdout. End docs/workflows/v1-workflow-backlog.md with V1_WORKFLOW_BACKLOG_READY.`,
      verification: { type: 'file_exists', value: 'docs/workflows/v1-workflow-backlog.md' },
    })

    .step('review-specs-and-program', {
      agent: 'review-codex',
      dependsOn: ['author-specs', 'author-v1-program'],
      task: `Review the new spec and v1 program docs for agent-assistant-sdk.

Read:
- docs/architecture/spec-program-plan.md
- docs/specs/v1-core-spec.md
- docs/specs/v1-sessions-spec.md
- docs/specs/v1-memory-spec.md
- docs/specs/v1-surfaces-spec.md
- docs/specs/v1-connectivity-spec.md
- docs/specs/v1-routing-spec.md
- docs/architecture/v1-sectioning-and-priorities.md
- docs/workflows/v1-workflow-backlog.md
- docs/workflows/weekend-delivery-plan.md

Assess:
1. Are these docs concrete enough to become implementation inputs this weekend?
2. Is the v1 sectioning coherent and useful?
3. Is the workflow backlog sequenced sensibly?
4. Are Sage, MSD, and NightCTO adoption goals actually reflected?
5. What still needs tightening before implementation workflows begin?

Write docs/architecture/spec-program-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with SPEC_PROGRAM_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/spec-program-review-verdict.md' },
    })

    .step('verify-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-specs-and-program'],
      command: [
        'test -f docs/architecture/spec-program-plan.md',
        'test -f docs/specs/v1-core-spec.md',
        'test -f docs/specs/v1-sessions-spec.md',
        'test -f docs/specs/v1-memory-spec.md',
        'test -f docs/specs/v1-surfaces-spec.md',
        'test -f docs/specs/v1-connectivity-spec.md',
        'test -f docs/specs/v1-routing-spec.md',
        'test -f docs/architecture/v1-sectioning-and-priorities.md',
        'test -f docs/workflows/v1-workflow-backlog.md',
        'test -f docs/workflows/weekend-delivery-plan.md',
        'test -f docs/architecture/spec-program-review-verdict.md',
        'grep -q "SPEC_PROGRAM_PLAN_READY" docs/architecture/spec-program-plan.md',
        'grep -q "SPEC_READY" docs/specs/v1-core-spec.md',
        'grep -q "SPEC_READY" docs/specs/v1-sessions-spec.md',
        'grep -q "SPEC_READY" docs/specs/v1-memory-spec.md',
        'grep -q "SPEC_READY" docs/specs/v1-surfaces-spec.md',
        'grep -q "SPEC_READY" docs/specs/v1-connectivity-spec.md',
        'grep -q "SPEC_READY" docs/specs/v1-routing-spec.md',
        'grep -q "V1_WORKFLOW_BACKLOG_READY" docs/workflows/v1-workflow-backlog.md',
        'grep -q "SPEC_PROGRAM_REVIEW_COMPLETE" docs/architecture/spec-program-review-verdict.md',
        'echo "SPECS_AND_V1_PROGRAM_VERIFIED"',
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
