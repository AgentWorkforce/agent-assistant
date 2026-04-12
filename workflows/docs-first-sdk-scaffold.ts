import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
const result = await workflow('agent-assistant-sdk-docs-first-scaffold')
  .description('Design and author a tightly organized docs-first scaffold for the open-source Agent Assistant SDK SDK, including consumer usage guidance and a cloud adapter direction.')
  .pattern('supervisor')
  .channel('wf-agent-assistant-sdk-docs')
  .maxConcurrency(4)
  .timeout(3_600_000)

  .agent('lead', {
    cli: 'claude',
    model: ClaudeModels.OPUS,
    role: 'Lead architect for assistant-sdk docs structure, package boundaries, and narrative coherence',
    retries: 1,
  })
  .agent('research-codex', {
    cli: 'codex',
    model: CodexModels.GPT_5_4,
    preset: 'worker',
    role: 'Maps existing relay/sage/msd/nightcto concepts into proposed sdk boundaries',
    retries: 1,
  })
  .agent('author-codex', {
    cli: 'codex',
    model: CodexModels.GPT_5_4,
    preset: 'worker',
    role: 'Writes the docs-first repo scaffold and package placeholder docs',
    retries: 1,
  })
  .agent('review-claude', {
    cli: 'claude',
    model: ClaudeModels.SONNET,
    preset: 'reviewer',
    role: 'Reviews structure, open-source posture, consumer guidance, and cloud split clarity',
    retries: 1,
  })

  .step('capture-context', {
    type: 'deterministic',
    command: [
      'pwd',
      'printf "\\n---README---\\n"',
      'sed -n "1,220p" README.md',
      'printf "\\n---LANDSCAPE---\\n"',
      'sed -n "1,260p" docs/research/2026-04-11-assistant-sdk-landscape.md',
      'printf "\\n---ARCHITECTURE---\\n"',
      'sed -n "1,260p" docs/architecture/2026-04-11-agent-assistant-sdk-architecture-draft.md',
      'printf "\\n---RELAY GATEWAY INDEX---\\n"',
      'sed -n "1,220p" ../relay/packages/gateway/src/index.ts',
      'printf "\\n---RELAY GATEWAY TYPES---\\n"',
      'sed -n "1,260p" ../relay/packages/gateway/src/types.ts',
      'printf "\\n---SAGE SIGNALS---\\n"',
      'rg -n "SageMemory|OrgMemory|follow-up|stale-thread|context watch|proactive|slack|session" ../sage/src ../sage/README.md',
      'printf "\\n---MSD SIGNALS---\\n"',
      'rg -n "shared chat-surface|review runtime|session|surface|heartbeat|memory|proactive" ../My-Senior-Dev/app/docs ../My-Senior-Dev/app/packages 2>/dev/null | head -n 200',
      'printf "\\n---NIGHTCTO SIGNALS---\\n"',
      'rg -n "Communicate SDK|Supermemory|agent-relay|relaycast|cron|specialist|dispatch|triage|heartbeat" ../nightcto/README.md ../nightcto/ARCHITECTURE.md ../nightcto/docs/WORKFLOW_PROGRAM.md | head -n 220',
    ].join(' && '),
    captureOutput: true,
    failOnError: true,
  })

  .step('map-sdk-boundaries', {
    agent: 'research-codex',
    dependsOn: ['capture-context'],
    task: `Using the captured context below, produce a concise but concrete boundary map for the Agent Assistant SDK SDK.

{{steps.capture-context.output}}

Write your findings to docs/architecture/package-boundary-map.md.

Required sections:
1. What belongs in relay foundation vs agent-assistant-sdk sdk vs product repos
2. Mapping from existing sources (relay, sage, msd, nightcto) into proposed @agent-assistant/* packages
3. OSS core vs future cloud implementation split
4. Recommended first extraction order

Keep it practical and implementation-oriented. End the file with BOUNDARY_MAP_COMPLETE.` ,
    verification: { type: 'file_exists', value: 'docs/architecture/package-boundary-map.md' },
  })

  .step('author-docs-scaffold', {
    agent: 'author-codex',
    dependsOn: ['map-sdk-boundaries'],
    task: `Build a tightly organized docs-first scaffold for this open-source repo.

Context:
- This repo should become the shared assistant SDK/runtime for Sage, MSD, NightCTO, and future agents.
- It should explicitly support a later cloud implementation built on top of the OSS SDK, similar in spirit to how other AgentWorkforce properties separate OSS core from Cloudflare-backed cloud adapters.
- Consumers should understand how to use the sdk, what package to import, and what remains product-specific.

Required files to create or update:
- README.md
- docs/architecture/package-boundary-map.md (refine if needed)
- docs/architecture/extraction-roadmap.md
- docs/architecture/oss-vs-cloud-split.md
- docs/consumer/how-to-build-an-assistant.md
- docs/consumer/how-products-should-adopt-agent-assistant-sdk.md
- docs/research/internal-system-comparison.md
- packages/core/README.md
- packages/memory/README.md
- packages/proactive/README.md
- packages/sessions/README.md
- packages/surfaces/README.md
- packages/coordination/README.md
- packages/policy/README.md
- packages/examples/README.md

Requirements:
- docs-first, tightly organized, no fluff
- explain how consumers (like Sage, MSD, NightCTO) should adopt the sdk
- explain what remains in relay foundation vs what moves here
- include the cloud implementation direction clearly: OSS sdk here, cloud adapter/infrastructure package elsewhere later
- keep everything open-source-friendly and repo-ready
- do not invent actual package implementation code yet; placeholders/docs only

IMPORTANT: write files to disk, do not print the docs to stdout. End README.md with the phrase DOCS_FIRST_SCAFFOLD_READY.`,
    verification: { type: 'file_exists', value: 'docs/consumer/how-to-build-an-assistant.md' },
  })

  .step('review-scaffold', {
    agent: 'review-claude',
    dependsOn: ['author-docs-scaffold'],
    task: `Review the docs scaffold for the Agent Assistant SDK repo.

Read these files:
- README.md
- docs/architecture/package-boundary-map.md
- docs/architecture/extraction-roadmap.md
- docs/architecture/oss-vs-cloud-split.md
- docs/consumer/how-to-build-an-assistant.md
- docs/consumer/how-products-should-adopt-agent-assistant-sdk.md
- docs/research/internal-system-comparison.md
- packages/core/README.md
- packages/memory/README.md
- packages/proactive/README.md
- packages/sessions/README.md
- packages/surfaces/README.md
- packages/coordination/README.md
- packages/policy/README.md
- packages/examples/README.md

Assess:
1. Is the repo tightly organized and coherent?
2. Is consumer adoption guidance clear enough for Sage/MSD/NightCTO style products?
3. Is the OSS-vs-cloud split clear and consistent?
4. Are the package boundaries clean and believable?
5. What should be fixed before this becomes the canonical research repo?

Write your verdict to docs/architecture/review-verdict.md.
Use one of: PASS, PASS_WITH_FOLLOWUPS, FAIL.
End the file with REVIEW_COMPLETE.`,
    verification: { type: 'file_exists', value: 'docs/architecture/review-verdict.md' },
  })

  .step('verify-artifacts', {
    type: 'deterministic',
    dependsOn: ['review-scaffold'],
    command: [
      'test -f README.md',
      'test -f docs/architecture/package-boundary-map.md',
      'test -f docs/architecture/extraction-roadmap.md',
      'test -f docs/architecture/oss-vs-cloud-split.md',
      'test -f docs/architecture/review-verdict.md',
      'test -f docs/consumer/how-to-build-an-assistant.md',
      'test -f docs/consumer/how-products-should-adopt-agent-assistant-sdk.md',
      'test -f docs/research/internal-system-comparison.md',
      'test -f packages/core/README.md',
      'test -f packages/memory/README.md',
      'test -f packages/proactive/README.md',
      'test -f packages/sessions/README.md',
      'test -f packages/surfaces/README.md',
      'test -f packages/coordination/README.md',
      'test -f packages/policy/README.md',
      'test -f packages/examples/README.md',
      'grep -q "DOCS_FIRST_SCAFFOLD_READY" README.md',
      'grep -q "BOUNDARY_MAP_COMPLETE" docs/architecture/package-boundary-map.md',
      'grep -q "REVIEW_COMPLETE" docs/architecture/review-verdict.md',
      'echo "DOCS_SCAFFOLD_VERIFIED"',
    ].join(' && '),
    captureOutput: true,
    failOnError: true,
  })

  .run({ cwd: process.cwd() });

console.log(result.status);

console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
