import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function runWorkflow() {
  const result = await workflow('trace-sage-proactivity-relaycron')
    .description('Trace Sage proactivity end-to-end from relaycron through Cloud delivery into Sage proactive handling, capturing where the chain breaks and what evidence proves it.')
    .pattern('dag')
    .channel('wf-trace-sage-proactivity-relaycron')
    .maxConcurrency(3)
    .timeout(60 * 60 * 1000)

    .agent('lead', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Investigation lead. Synthesize evidence, identify the exact break in the proactivity path, and produce a grounded verdict.',
      retries: 1,
    })
    .agent('cloud-tracer', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Inspect Cloud relaycron and delivery paths. Read code and config only, no speculative fixes.',
      preset: 'worker',
      retries: 2,
    })
    .agent('sage-tracer', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Inspect Sage proactive scheduling, ingestion, and handler paths. Produce concise evidence.',
      preset: 'worker',
      retries: 2,
    })

    .step('read-cloud-context', {
      type: 'deterministic',
      command: `cd ~/Projects/AgentWorkforce/cloud && \
        printf '=== relaycron refs ===\n' && rg -n "relaycron|cron|schedule|trigger|proactive" packages infra sst.config.ts .github | sed -n '1,260p' && \
        printf '\n=== candidate files ===\n' && find packages infra -type f | rg 'relaycron|cron|schedule|sage-worker|worker|proactive' | sed -n '1,200p'`,
      captureOutput: true,
      failOnError: true,
    })
    .step('read-sage-context', {
      type: 'deterministic',
      command: `cd ~/Projects/AgentWorkforce/sage && \
        printf '=== proactive refs ===\n' && rg -n "registerProactiveSchedules|proactive|scheduler|follow-up|stale-thread|context-watch|pr-match|relaycron|cron" src docs package.json | sed -n '1,300p' && \
        printf '\n=== candidate files ===\n' && find src -type f | rg 'proactive|scheduler|index|app' | sed -n '1,240p'`,
      captureOutput: true,
      failOnError: true,
    })

    .step('trace-cloud-path', {
      agent: 'cloud-tracer',
      dependsOn: ['read-cloud-context'],
      task: `You are tracing the Cloud side of Sage proactivity.

Repository: ~/Projects/AgentWorkforce/cloud

Context:
{{steps.read-cloud-context.output}}

Tasks:
1. Identify the concrete runtime path from schedule registration/firing to any Sage-targeted delivery.
2. Name the exact files/functions involved.
3. State whether relaycron appears responsible for firing, forwarding, or both.
4. List any obvious missing link, env dependency, or integration seam.
5. Write findings to /tmp/cloud-proactivity-trace.md.

Required output file format:
- Path summary
- Evidence bullets with file paths
- Most likely breakpoints
- Confidence and unknowns

Do not implement fixes. Do not speculate beyond evidence.`,
      verification: { type: 'file_exists', value: '/tmp/cloud-proactivity-trace.md' },
      retries: 2,
    })
    .step('trace-sage-path', {
      agent: 'sage-tracer',
      dependsOn: ['read-sage-context'],
      task: `You are tracing the Sage side of proactivity.

Repository: ~/Projects/AgentWorkforce/sage

Context:
{{steps.read-sage-context.output}}

Tasks:
1. Identify how proactive schedules are registered.
2. Identify the runtime entrypoints for follow-ups / stale-thread / context-watch / PR match.
3. Determine what external trigger or scheduler invocation Sage expects.
4. Note any dependency on relay credentials, routes, env vars, or Cloud callbacks.
5. Write findings to /tmp/sage-proactivity-trace.md.

Required output file format:
- Registration path
- Runtime handling path
- Required external inputs
- Most likely breakpoints
- Confidence and unknowns

Do not implement fixes. Do not speculate beyond evidence.`,
      verification: { type: 'file_exists', value: '/tmp/sage-proactivity-trace.md' },
      retries: 2,
    })

    .step('synthesize-proactivity-verdict', {
      agent: 'lead',
      dependsOn: ['trace-cloud-path', 'trace-sage-path'],
      task: `Read these two files:
- /tmp/cloud-proactivity-trace.md
- /tmp/sage-proactivity-trace.md

Produce a final verdict in /tmp/sage-proactivity-verdict.md with:
1. Whether the relaycron -> Cloud -> Sage proactive chain is complete or broken
2. The most likely exact failure point
3. The minimum bounded remediation slice
4. The proof needed to validate the remediation

End the file with the marker:
SAGE_PROACTIVITY_TRACE_COMPLETE`,
      verification: { type: 'file_exists', value: '/tmp/sage-proactivity-verdict.md' },
      retries: 2,
    })

    .step('verify-proactivity-verdict', {
      type: 'deterministic',
      dependsOn: ['synthesize-proactivity-verdict'],
      command: `grep -q 'SAGE_PROACTIVITY_TRACE_COMPLETE' /tmp/sage-proactivity-verdict.md && cat /tmp/sage-proactivity-verdict.md`,
      captureOutput: true,
      failOnError: true,
    })

    .run({ cwd: process.cwd() });

  console.log('Workflow status:', result.status);
}

runWorkflow().catch((error) => {
  console.error(error);
  process.exit(1);
});
