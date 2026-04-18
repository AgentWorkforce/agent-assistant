import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function runWorkflow() {
  const result = await workflow('master-sage-proactivity-and-specialists')
    .description('Supervisor workflow for overnight investigation of Sage proactivity, relay credential provisioning, and expanded always-on specialist architecture. Produces a prioritized next-action verdict from three subordinate traces.')
    .pattern('dag')
    .channel('wf-master-sage-proactivity-and-specialists')
    .maxConcurrency(4)
    .timeout(2 * 60 * 60 * 1000)

    .agent('lead', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Supervisor. Review all subordinate workflow outputs and produce a strict next-wave priority order with evidence.',
      retries: 1,
    })
    .agent('runner-a', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Run the proactivity trace workflow and capture the resulting verdict.',
      preset: 'worker',
      retries: 2,
    })
    .agent('runner-b', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Run the relay credentials trace workflow and capture the resulting verdict.',
      preset: 'worker',
      retries: 2,
    })
    .agent('runner-c', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Run the expanded specialists specification workflow and capture the resulting plan.',
      preset: 'worker',
      retries: 2,
    })

    .step('run-proactivity-trace', {
      agent: 'runner-a',
      task: `In ~/Projects/AgentWorkforce/relay-agent-assistant, run:
~/.local/bin/agent-relay run workflows/trace-sage-proactivity-relaycron.ts

When done, write a concise summary plus the full verdict file contents to /tmp/master-proactivity-trace.txt.
Include the workflow exit status and whether the verification marker was present.`,
      verification: { type: 'file_exists', value: '/tmp/master-proactivity-trace.txt' },
      retries: 2,
    })
    .step('run-relay-credentials-trace', {
      agent: 'runner-b',
      task: `In ~/Projects/AgentWorkforce/relay-agent-assistant, run:
~/.local/bin/agent-relay run workflows/trace-sage-relay-credentials-cloud.ts

When done, write a concise summary plus the full verdict file contents to /tmp/master-relay-credentials-trace.txt.
Include the workflow exit status and whether the verification marker was present.`,
      verification: { type: 'file_exists', value: '/tmp/master-relay-credentials-trace.txt' },
      retries: 2,
    })
    .step('run-specialist-expansion-spec', {
      agent: 'runner-c',
      task: `In ~/Projects/AgentWorkforce/relay-agent-assistant, run:
~/.local/bin/agent-relay run workflows/specify-expanded-domain-specialists.ts

When done, write a concise summary plus the full plan file contents to /tmp/master-specialist-expansion.txt.
Include the workflow exit status and whether the verification marker was present.`,
      verification: { type: 'file_exists', value: '/tmp/master-specialist-expansion.txt' },
      retries: 2,
    })

    .step('synthesize-master-verdict', {
      agent: 'lead',
      dependsOn: [
        'run-proactivity-trace',
        'run-relay-credentials-trace',
        'run-specialist-expansion-spec',
      ],
      task: `Read:
- /tmp/master-proactivity-trace.txt
- /tmp/master-relay-credentials-trace.txt
- /tmp/master-specialist-expansion.txt

Write /tmp/master-sage-proactivity-and-specialists-verdict.md with:
1. The actual current state of Sage proactivity
2. The actual current state of relay credential provisioning for Sage specialist runtime
3. The recommended priority order for the next implementation wave
4. Which fix should be executed first tomorrow
5. Which expanded specialist slice should follow after runtime/proactivity are stable

End the file with:
MASTER_SAGE_PROACTIVITY_AND_SPECIALISTS_COMPLETE`,
      verification: { type: 'file_exists', value: '/tmp/master-sage-proactivity-and-specialists-verdict.md' },
      retries: 2,
    })

    .step('verify-master-verdict', {
      type: 'deterministic',
      dependsOn: ['synthesize-master-verdict'],
      command: `grep -q 'MASTER_SAGE_PROACTIVITY_AND_SPECIALISTS_COMPLETE' /tmp/master-sage-proactivity-and-specialists-verdict.md && cat /tmp/master-sage-proactivity-and-specialists-verdict.md`,
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
