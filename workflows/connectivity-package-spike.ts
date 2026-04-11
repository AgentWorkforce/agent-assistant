const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('relay-agent-assistant-connectivity-spike')
    .description('Spike the @relay-assistant/connectivity package and author detailed docs/spec material for focused inter-agent signaling, convergence, and efficient assistant coordination.')
    .pattern('supervisor')
    .channel('wf-relay-assistant-connectivity')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead architect for connectivity package scope, neural-style coordination framing, and final document coherence',
      retries: 1,
    })
    .agent('research-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      role: 'Researches focused coordination concepts and maps them into assistant-sdk package boundaries',
      retries: 1,
    })
    .agent('author-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      role: 'Authors the connectivity package docs, readme, and detailed spike outputs',
      retries: 1,
    })
    .agent('review-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'reviewer',
      role: 'Reviews the connectivity docs for architectural clarity, packaging, and practical usefulness',
      retries: 1,
    })

    .step('capture-context', {
      type: 'deterministic',
      command: [
        'printf "---README---\\n"',
        'sed -n "1,240p" README.md',
        'printf "\\n---PACKAGE MAP---\\n"',
        'sed -n "1,280p" docs/architecture/package-boundary-map.md',
        'printf "\\n---BUILD AN ASSISTANT---\\n"',
        'sed -n "1,280p" docs/consumer/how-to-build-an-assistant.md',
        'printf "\\n---INTERNAL COMPARISON---\\n"',
        'sed -n "1,280p" docs/research/internal-system-comparison.md',
        'printf "\\n---CONNECTIVITY README---\\n"',
        'sed -n "1,220p" packages/connectivity/README.md',
        'printf "\\n---RELAY GATEWAY TYPES---\\n"',
        'sed -n "1,260p" ../relay/packages/gateway/src/types.ts',
        'printf "\n---WORKFORCE ROUTING---\n"',
        'sed -n "1,260p" ../workforce/README.md',
        'printf "\n---WORKFORCE ROUTER---\n"',
        'sed -n "1,260p" ../workforce/packages/workload-router/README.md',
        'printf "\n---WORKFORCE ROUTING PROFILE---\n"',
        'sed -n "1,220p" ../workforce/packages/workload-router/routing-profiles/default.json',
        'printf "\\n---NIGHTCTO SIGNALS---\\n"',
        'rg -n "specialist|dispatch|triage|relaycast|channel|cron|digest|alert|coordinator|agent-relay" ../nightcto/README.md ../nightcto/ARCHITECTURE.md ../nightcto/workflows 2>/dev/null | head -n 220 || true',
        'printf "\\n---SAGE SIGNALS---\\n"',
        'rg -n "memory|proactive|follow-up|stale-thread|context watch|slack|session" ../sage/src ../sage/README.md | head -n 220 || true',
        'printf "\\n---MSD SIGNALS---\\n"',
        'rg -n "shared chat-surface|session|surface|notifier|orchestrator|runtime|heartbeat|review runtime" ../My-Senior-Dev/app/docs ../My-Senior-Dev/app/packages 2>/dev/null | head -n 220 || true',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('research-connectivity-model', {
      agent: 'research-codex',
      dependsOn: ['capture-context'],
      task: `Using the captured context below, research and define the connectivity package as a first-class sdk layer.

{{steps.capture-context.output}}

Write docs/architecture/connectivity-package-spec.md.

The document must cover:
1. Why connectivity is distinct from coordination and distinct from relay transport
2. Neural / brain-inspired framing that is still practical and not hand-wavy
3. The main message/signal categories the package should own
4. When to narrowcast, broadcast, escalate, or stay silent
5. How this package should help sophisticated subsystems converge efficiently
6. How connectivity should interact with routing/model-choice concerns influenced by workforce
7. What the first exportable interfaces or contracts should likely be
8. What belongs in OSS core vs future cloud layer

End the document with CONNECTIVITY_SPEC_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/connectivity-package-spec.md' },
    })

    .step('author-connectivity-docs', {
      agent: 'author-codex',
      dependsOn: ['research-connectivity-model'],
      task: `Author a strong docs spike for the connectivity package.

Required files to create or update:
- packages/connectivity/README.md
- docs/architecture/connectivity-package-spec.md
- docs/consumer/connectivity-adoption-guide.md
- docs/research/connectivity-patterns.md

Requirements:
- tightly scoped and practical
- explain focused coordination messages vs generic chatter
- explain how Sage, MSD, and NightCTO would each use connectivity
- define message classes / signal classes conceptually
- define efficiency principles: low latency, selective routing, bounded verbosity, convergence over chatter
- reflect workforce-informed routing realities such as cheap/fast/deep response modes and fixed quality bar across tiers
- include guidance for how this eventually becomes specs, then workflows, then code
- keep the docs OSS-first, with any cloud-specific behavior clearly deferred or adapter-based

Also update README.md and docs/index.md so connectivity is easier to discover.

IMPORTANT: write files to disk. Do not print full docs to stdout. End packages/connectivity/README.md with CONNECTIVITY_DOCS_READY.`,
      verification: { type: 'file_exists', value: 'docs/consumer/connectivity-adoption-guide.md' },
    })

    .step('review-connectivity-docs', {
      agent: 'review-claude',
      dependsOn: ['author-connectivity-docs'],
      task: `Review the connectivity package spike.

Read these files:
- packages/connectivity/README.md
- docs/architecture/connectivity-package-spec.md
- docs/consumer/connectivity-adoption-guide.md
- docs/research/connectivity-patterns.md
- README.md
- docs/index.md

Assess:
1. Is connectivity clearly distinct from coordination and transport?
2. Is the neural-style framing practical rather than fluffy?
3. Is the package useful for Sage, MSD, and NightCTO specifically?
4. Are the docs detailed enough to become implementation specs next?
5. What is still missing before this package is ready to move into specs/workflows/code?

Write docs/architecture/connectivity-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with CONNECTIVITY_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/connectivity-review-verdict.md' },
    })

    .step('verify-connectivity-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-connectivity-docs'],
      command: [
        'test -f packages/connectivity/README.md',
        'test -f docs/architecture/connectivity-package-spec.md',
        'test -f docs/consumer/connectivity-adoption-guide.md',
        'test -f docs/research/connectivity-patterns.md',
        'test -f docs/architecture/connectivity-review-verdict.md',
        'grep -q "CONNECTIVITY_DOCS_READY" packages/connectivity/README.md',
        'grep -q "CONNECTIVITY_SPEC_COMPLETE" docs/architecture/connectivity-package-spec.md',
        'grep -q "CONNECTIVITY_REVIEW_COMPLETE" docs/architecture/connectivity-review-verdict.md',
        'echo "CONNECTIVITY_SPIKE_VERIFIED"',
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
