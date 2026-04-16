import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('specify-v1-specialist-delegation-relayfile-evidence')
    .description('Define the first bounded Agent Assistant specialist-delegation architecture for Relay-native agent-to-agent collaboration, relayfile-backed evidence exchange, and a reusable GitHub investigation specialist, with Sage as the proving adopter.')
    .pattern('supervisor')
    .channel('wf-specify-v1-specialist-delegation-relayfile-evidence')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      preset: 'analyst',
      role: 'Defines the bounded specialist-delegation and relayfile-backed evidence architecture, including GitHub specialist and Sage adoption boundaries.',
      retries: 1,
    })
    .agent('author-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Authors the boundary docs, adoption map, and workflow-ready proof plan for Relay-native specialist delegation.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the specialist-delegation boundary for boundedness, relay-native fit, and correct Sage vs Agent Assistant separation.',
      retries: 1,
    })

    .step('read-agent-assistant-collaboration-context', {
      type: 'deterministic',
      command: [
        'echo "---PACKAGE BOUNDARY MAP---"',
        'sed -n "1,320p" docs/architecture/package-boundary-map.md',
        'echo "" && echo "---CURRENT STATE---"',
        'sed -n "1,260p" docs/current-state.md',
        'echo "" && echo "---TURN CONTEXT README---"',
        'sed -n "1,220p" packages/turn-context/README.md',
        'echo "" && echo "---CONTINUATION README---"',
        'sed -n "1,220p" packages/continuation/README.md',
        'echo "" && echo "---SESSIONS README---"',
        'sed -n "1,220p" packages/sessions/README.md',
        'echo "" && echo "---SURFACES README---"',
        'sed -n "1,220p" packages/surfaces/README.md',
        'echo "" && echo "---INBOX README---"',
        'sed -n "1,220p" packages/inbox/README.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('read-sage-proving-context', {
      type: 'deterministic',
      command: [
        'echo "---SAGE CLIENT API---"',
        'sed -n "500,690p" ../sage/src/app/client-api.ts',
        'echo "" && echo "---SAGE ORCHESTRATOR---"',
        'sed -n "260,460p" ../sage/src/swarm/orchestrator.ts',
        'echo "" && echo "---SAGE ROUTER---"',
        'sed -n "1,260p" ../sage/src/swarm/router.ts',
        'echo "" && echo "---SAGE SYNTHESIZER---"',
        'sed -n "1,220p" ../sage/src/swarm/synthesizer.ts',
        'echo "" && echo "---SAGE GITHUB TOOL---"',
        'sed -n "1,620p" ../sage/src/swarm/github-tool.ts',
        'echo "" && echo "---SAGE RELAYFILE READER---"',
        'sed -n "1,320p" ../sage/src/integrations/relayfile-reader.ts',
        'echo "" && echo "---SAGE PROMPT IDENTITY/CAPABILITIES---"',
        'sed -n "1,220p" ../sage/src/prompt/layers/identity.ts',
        'echo "" && echo "---"',
        'sed -n "1,220p" ../sage/src/prompt/layers/capabilities.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('define-specialist-delegation-boundary', {
      agent: 'lead-claude',
      dependsOn: ['read-agent-assistant-collaboration-context', 'read-sage-proving-context'],
      task: `Define the first bounded specialist-delegation boundary for Agent Assistant.

Agent Assistant collaboration context:
{{steps.read-agent-assistant-collaboration-context.output}}

Sage proving context:
{{steps.read-sage-proving-context.output}}

Write:
- docs/architecture/v1-specialist-delegation-boundary.md
- docs/architecture/v1-agent-to-agent-evidence-exchange.md
- docs/architecture/v1-relayfile-backed-evidence-contract.md
- docs/architecture/v1-github-investigation-specialist-boundary.md

Requirements:
1. Treat Relay-native agent-to-agent communication as first-class. Do not collapse this into internal helper functions or one-agent tool wrappers.
2. Define the bounded request/response contract for specialist delegation, including request scope, findings, evidence, confidence, gaps, and recommended next actions/delegates.
3. Make relayfile-backed evidence/state a first-class part of the contract: distinguish ephemeral chat context from durable shared artifacts.
4. Define the first GitHub investigation specialist as VFS-first with API fallback, returning structured evidence rather than only natural-language summaries.
5. Explicitly separate what belongs in Agent Assistant versus what remains product-owned in Sage.
6. Keep the slice bounded. Do not propose a giant universal orchestrator or a fully general multi-agent framework in v1.
7. Keep the architecture aligned to future reuse by Sage, MSD, and NightCTO.

End docs/architecture/v1-specialist-delegation-boundary.md with V1_SPECIALIST_DELEGATION_BOUNDARY_READY.
End docs/architecture/v1-agent-to-agent-evidence-exchange.md with V1_AGENT_TO_AGENT_EVIDENCE_EXCHANGE_READY.
End docs/architecture/v1-relayfile-backed-evidence-contract.md with V1_RELAYFILE_BACKED_EVIDENCE_CONTRACT_READY.
End docs/architecture/v1-github-investigation-specialist-boundary.md with V1_GITHUB_INVESTIGATION_SPECIALIST_BOUNDARY_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-specialist-delegation-boundary.md' },
    })

    .step('author-sage-adoption-and-proof-plan', {
      agent: 'author-codex',
      dependsOn: ['define-specialist-delegation-boundary'],
      task: `Turn the specialist-delegation boundary into a workflow-ready proving plan.

Read and follow:
- docs/architecture/v1-specialist-delegation-boundary.md
- docs/architecture/v1-agent-to-agent-evidence-exchange.md
- docs/architecture/v1-relayfile-backed-evidence-contract.md
- docs/architecture/v1-github-investigation-specialist-boundary.md

Write:
- docs/architecture/v1-sage-specialist-adoption-map.md
- docs/architecture/v1-specialist-delegation-proof-plan.md
- docs/architecture/v1-specialist-delegation-no-shortcuts-checklist.md

Requirements:
1. Define a concrete proving sequence for Sage-first adoption:
   - boundary/spec complete
   - Sage proving implementation
   - Agent Assistant reusable substrate implementation
   - Sage re-adoption against shared substrate
2. Specify the narrowest viable Sage proving slice that improves investigation quality immediately without overcommitting architecture.
3. Define validation gates for specialist request/response shape, relayfile evidence shape, and answer/plan grounding quality.
4. Explicitly state what not to do in v1, including over-generalized orchestration and stuffing product-specific behavior into Agent Assistant.
5. Make the plan concrete enough to become immediate follow-up workflows in Agent Assistant and Sage.

End docs/architecture/v1-sage-specialist-adoption-map.md with V1_SAGE_SPECIALIST_ADOPTION_MAP_READY.
End docs/architecture/v1-specialist-delegation-proof-plan.md with V1_SPECIALIST_DELEGATION_PROOF_PLAN_READY.
End docs/architecture/v1-specialist-delegation-no-shortcuts-checklist.md with V1_SPECIALIST_DELEGATION_NO_SHORTCUTS_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-sage-specialist-adoption-map.md' },
    })

    .step('review-specialist-delegation-plan', {
      agent: 'review-codex',
      dependsOn: ['author-sage-adoption-and-proof-plan'],
      task: `Review the specialist-delegation boundary and workflow-ready proof plan.

Read:
- docs/architecture/v1-specialist-delegation-boundary.md
- docs/architecture/v1-agent-to-agent-evidence-exchange.md
- docs/architecture/v1-relayfile-backed-evidence-contract.md
- docs/architecture/v1-github-investigation-specialist-boundary.md
- docs/architecture/v1-sage-specialist-adoption-map.md
- docs/architecture/v1-specialist-delegation-proof-plan.md
- docs/architecture/v1-specialist-delegation-no-shortcuts-checklist.md

Assess:
1. Is Relay-native agent-to-agent communication truly first-class in the proposed design?
2. Is relayfile used as durable shared evidence/state, rather than just extra chat context?
3. Is the GitHub specialist bounded and reusable, rather than Sage-specific prompt glue?
4. Is the Sage vs Agent Assistant split clear and defensible?
5. Is the v1 slice tight enough to implement without architectural sprawl?
6. Is this PASS, PASS_WITH_FOLLOWUPS, or FAIL?

Write docs/architecture/v1-specialist-delegation-review-verdict.md.
End with V1_SPECIALIST_DELEGATION_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-specialist-delegation-review-verdict.md' },
    })

    .step('verify-specialist-delegation-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-specialist-delegation-plan'],
      command: [
        'test -f docs/architecture/v1-specialist-delegation-boundary.md',
        'test -f docs/architecture/v1-agent-to-agent-evidence-exchange.md',
        'test -f docs/architecture/v1-relayfile-backed-evidence-contract.md',
        'test -f docs/architecture/v1-github-investigation-specialist-boundary.md',
        'test -f docs/architecture/v1-sage-specialist-adoption-map.md',
        'test -f docs/architecture/v1-specialist-delegation-proof-plan.md',
        'test -f docs/architecture/v1-specialist-delegation-no-shortcuts-checklist.md',
        'test -f docs/architecture/v1-specialist-delegation-review-verdict.md',
        'grep -q "V1_SPECIALIST_DELEGATION_BOUNDARY_READY" docs/architecture/v1-specialist-delegation-boundary.md',
        'grep -q "V1_AGENT_TO_AGENT_EVIDENCE_EXCHANGE_READY" docs/architecture/v1-agent-to-agent-evidence-exchange.md',
        'grep -q "V1_RELAYFILE_BACKED_EVIDENCE_CONTRACT_READY" docs/architecture/v1-relayfile-backed-evidence-contract.md',
        'grep -q "V1_GITHUB_INVESTIGATION_SPECIALIST_BOUNDARY_READY" docs/architecture/v1-github-investigation-specialist-boundary.md',
        'grep -q "V1_SAGE_SPECIALIST_ADOPTION_MAP_READY" docs/architecture/v1-sage-specialist-adoption-map.md',
        'grep -q "V1_SPECIALIST_DELEGATION_PROOF_PLAN_READY" docs/architecture/v1-specialist-delegation-proof-plan.md',
        'grep -q "V1_SPECIALIST_DELEGATION_NO_SHORTCUTS_READY" docs/architecture/v1-specialist-delegation-no-shortcuts-checklist.md',
        'grep -q "V1_SPECIALIST_DELEGATION_REVIEW_COMPLETE" docs/architecture/v1-specialist-delegation-review-verdict.md',
        'echo "V1_SPECIALIST_DELEGATION_ARTIFACTS_VERIFIED"',
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
