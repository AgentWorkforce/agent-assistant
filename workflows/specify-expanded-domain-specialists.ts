import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function runWorkflow() {
  const result = await workflow('specify-expanded-domain-specialists')
    .description('Define the next always-on expanded domain specialist layer for Sage, prioritizing broader GitHub capability and a Notion specialist that maintains stronger workspace understanding.')
    .pattern('dag')
    .channel('wf-specify-expanded-domain-specialists')
    .maxConcurrency(3)
    .timeout(60 * 60 * 1000)

    .agent('lead', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Architecture lead. Turn evidence into a bounded specialist expansion plan that fits current Sage and Agent Assistant seams.',
      retries: 1,
    })
    .agent('agent-assistant-analyst', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Inspect Agent Assistant specialists substrate and identify reusable seams for expanded always-on specialists.',
      preset: 'worker',
      retries: 2,
    })
    .agent('sage-analyst', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Inspect current Sage routing, specialist use, and retrieval weaknesses, especially around GitHub and Notion/VFS lookup behavior.',
      preset: 'worker',
      retries: 2,
    })

    .step('read-agent-assistant-context', {
      type: 'deterministic',
      command: `cd ~/Projects/AgentWorkforce/relay-agent-assistant && \
        rg -n "specialist|librarian|github|linear|investigator|librarian-engine|specialists" packages/specialists docs workflows | sed -n '1,360p'`,
      captureOutput: true,
      failOnError: true,
    })
    .step('read-sage-specialist-context', {
      type: 'deterministic',
      command: `cd ~/Projects/AgentWorkforce/sage && \
        rg -n "github-specialist|specialist|github_read_pr|github_get_issue|github_search_issues|notion_search_pages|vfs_search|synthesizer|router" src docs | sed -n '1,360p'`,
      captureOutput: true,
      failOnError: true,
    })

    .step('analyze-agent-assistant-specialists', {
      agent: 'agent-assistant-analyst',
      dependsOn: ['read-agent-assistant-context'],
      task: `Repository: ~/Projects/AgentWorkforce/relay-agent-assistant

Context:
{{steps.read-agent-assistant-context.output}}

Tasks:
1. Identify the current reusable specialist substrate relevant to always-on GitHub and Notion-like domain specialists.
2. Note which parts already support librarian/investigator behavior.
3. Write findings to /tmp/agent-assistant-specialist-expansion.md.

Required sections:
- Existing reusable seams
- What fits GitHub expansion
- What is missing for Notion
- Constraints to respect

Do not implement.`,
      verification: { type: 'file_exists', value: '/tmp/agent-assistant-specialist-expansion.md' },
      retries: 2,
    })
    .step('analyze-sage-specialist-needs', {
      agent: 'sage-analyst',
      dependsOn: ['read-sage-specialist-context'],
      task: `Repository: ~/Projects/AgentWorkforce/sage

Context:
{{steps.read-sage-specialist-context.output}}

Tasks:
1. Identify which GitHub question classes currently bypass meaningful specialist support.
2. Identify the specific weakness pattern for Notion/VFS search and answer rendering.
3. Write findings to /tmp/sage-specialist-needs.md.

Required sections:
- Current specialist coverage
- Major GitHub gaps
- Major Notion/VFS gaps
- Why users experience weak/confidently-wrong answers

Do not implement.`,
      verification: { type: 'file_exists', value: '/tmp/sage-specialist-needs.md' },
      retries: 2,
    })

    .step('synthesize-expansion-plan', {
      agent: 'lead',
      dependsOn: ['analyze-agent-assistant-specialists', 'analyze-sage-specialist-needs'],
      task: `Read:
- /tmp/agent-assistant-specialist-expansion.md
- /tmp/sage-specialist-needs.md

Write /tmp/expanded-domain-specialists-plan.md with:
1. The recommended expansion order
2. The next bounded GitHub specialist slice
3. The first bounded Notion specialist slice
4. How these specialists should stay always-on and inform Sage quickly/confidently
5. What belongs in Agent Assistant vs Sage

End the file with:
EXPANDED_DOMAIN_SPECIALISTS_PLAN_COMPLETE`,
      verification: { type: 'file_exists', value: '/tmp/expanded-domain-specialists-plan.md' },
      retries: 2,
    })

    .step('verify-expansion-plan', {
      type: 'deterministic',
      dependsOn: ['synthesize-expansion-plan'],
      command: `grep -q 'EXPANDED_DOMAIN_SPECIALISTS_PLAN_COMPLETE' /tmp/expanded-domain-specialists-plan.md && cat /tmp/expanded-domain-specialists-plan.md`,
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
