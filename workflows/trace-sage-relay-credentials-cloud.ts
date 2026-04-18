import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function runWorkflow() {
  const result = await workflow('trace-sage-relay-credentials-cloud')
    .description('Trace how Sage is supposed to receive relay credentials in Cloud, whether they are provisioned by default, and what runtime assumptions the specialist layer currently makes.')
    .pattern('dag')
    .channel('wf-trace-sage-relay-credentials-cloud')
    .maxConcurrency(3)
    .timeout(60 * 60 * 1000)

    .agent('lead', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead investigator. Synthesize Cloud and Sage runtime evidence into a crisp credential-provisioning verdict.',
      retries: 1,
    })
    .agent('cloud-runtime', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Inspect Cloud runtime env, worker boot, and secret propagation paths relevant to relay credentials.',
      preset: 'worker',
      retries: 2,
    })
    .agent('sage-runtime', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Inspect Sage specialist runtime assumptions around relay credentials and startup behavior.',
      preset: 'worker',
      retries: 2,
    })

    .step('read-cloud-runtime-context', {
      type: 'deterministic',
      command: `cd ~/Projects/AgentWorkforce/cloud && \
        rg -n "RELAY_API_KEY|RELAY_WORKSPACE_ID|relayApiKey|agent-relay|communicate|specialist|sage-worker|worker" packages infra sst.config.ts .github | sed -n '1,320p'`,
      captureOutput: true,
      failOnError: true,
    })
    .step('read-sage-runtime-context', {
      type: 'deterministic',
      command: `cd ~/Projects/AgentWorkforce/sage && \
        rg -n "RELAY_API_KEY|RELAY_WORKSPACE_ID|SAGE_GITHUB_SPECIALIST_ENABLED|github-specialist|createSwarmCommunicateRelay|startGitHubSpecialistAgent|communicate" src docs package.json | sed -n '1,320p'`,
      captureOutput: true,
      failOnError: true,
    })

    .step('trace-cloud-runtime', {
      agent: 'cloud-runtime',
      dependsOn: ['read-cloud-runtime-context'],
      task: `Repository: ~/Projects/AgentWorkforce/cloud

Context:
{{steps.read-cloud-runtime-context.output}}

Tasks:
1. Determine whether Sage runtime or sage-worker receives RELAY_API_KEY by default in normal Cloud deploys.
2. Identify exact secret/env propagation path if it exists.
3. If it does not exist, identify the closest intended seam where it should be provided.
4. Write findings to /tmp/cloud-relay-credentials-trace.md.

Required sections:
- Current credential path
- Default-on or not
- Missing wiring
- Risks / unknowns

Do not implement fixes.`,
      verification: { type: 'file_exists', value: '/tmp/cloud-relay-credentials-trace.md' },
      retries: 2,
    })
    .step('trace-sage-runtime', {
      agent: 'sage-runtime',
      dependsOn: ['read-sage-runtime-context'],
      task: `Repository: ~/Projects/AgentWorkforce/sage

Context:
{{steps.read-sage-runtime-context.output}}

Tasks:
1. Determine what relay credentials Sage specialist startup actually requires.
2. Identify what happens when creds are absent.
3. Identify which specialist paths depend on relay credentials vs inline fallback.
4. Write findings to /tmp/sage-relay-credentials-trace.md.

Required sections:
- Runtime assumptions
- Required env vars
- Fallback behavior
- Coverage gaps

Do not implement fixes.`,
      verification: { type: 'file_exists', value: '/tmp/sage-relay-credentials-trace.md' },
      retries: 2,
    })

    .step('synthesize-credential-verdict', {
      agent: 'lead',
      dependsOn: ['trace-cloud-runtime', 'trace-sage-runtime'],
      task: `Read:
- /tmp/cloud-relay-credentials-trace.md
- /tmp/sage-relay-credentials-trace.md

Write /tmp/sage-relay-credentials-verdict.md with:
1. Whether relay credentials are effectively provisioned for Sage by default on Cloud
2. Whether the current default-on specialist behavior can actually activate in deployed Cloud
3. The minimum bounded fix needed
4. The proof required after that fix

End the file with:
SAGE_RELAY_CREDENTIALS_TRACE_COMPLETE`,
      verification: { type: 'file_exists', value: '/tmp/sage-relay-credentials-verdict.md' },
      retries: 2,
    })

    .step('verify-credential-verdict', {
      type: 'deterministic',
      dependsOn: ['synthesize-credential-verdict'],
      command: `grep -q 'SAGE_RELAY_CREDENTIALS_TRACE_COMPLETE' /tmp/sage-relay-credentials-verdict.md && cat /tmp/sage-relay-credentials-verdict.md`,
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
