import { describe, expect, it } from 'vitest';

import { buildIntegrationsLayer } from './integrations-layer.js';

const EIGHT_REPOS = [
  'agent-assistant',
  'relayfile',
  'sage',
  'trail',
  'coordination',
  'connectivity',
  'turn-context',
  'workforce',
];

const TWENTY_TWO_REPOS = [
  'agent-assistant',
  'relayfile',
  'sage',
  'trail',
  'coordination',
  'connectivity',
  'turn-context',
  'workforce',
  'broker-sdk',
  'relay-cli',
  'workload-router',
  'persona-catalog',
  'runtime-core',
  'memory-store',
  'prompt-kit',
  'notion-sync',
  'slack-bridge',
  'github-bridge',
  'docs-site',
  'ops-console',
  'evidence-store',
  'tool-registry',
];

const SLACK_CHANNELS = ['general', 'eng-builds', 'launches'];

function getContent(result: ReturnType<typeof buildIntegrationsLayer>): string {
  expect(result).not.toBeNull();
  return result?.content ?? '';
}

function getSampleLine(content: string): string {
  const sampleLine = content
    .split('\n')
    .find((line) => line.startsWith('  Sample: '));

  expect(sampleLine).toBeDefined();
  return sampleLine ?? '';
}

function getSampleNames(content: string): string[] {
  return getSampleLine(content)
    .replace('  Sample: ', '')
    .replace(/\.$/, '')
    .split(', ');
}

describe('buildIntegrationsLayer', () => {
  it('<= maxInlineItems renders full list', () => {
    const content = getContent(
      buildIntegrationsLayer({
        github: {
          orgs: ['agent-workforce'],
          repoNames: EIGHT_REPOS,
        },
      }),
    );

    for (const repoName of EIGHT_REPOS) {
      expect(content).toContain(repoName);
    }
    expect(content).not.toContain('NOT exhaustive');
  });

  it('> maxInlineItems renders non-exhaustive marker', () => {
    const content = getContent(
      buildIntegrationsLayer({
        github: {
          orgs: ['agent-workforce'],
          repoNames: TWENTY_TWO_REPOS,
        },
      }),
    );

    expect(content).toContain(
      'NOT exhaustive — to enumerate, call workspace_list /github/repos',
    );
    expect(content).toContain('Workspace contains 22 repos.');

    const sampleNames = getSampleNames(content);
    expect(sampleNames).toHaveLength(5);
    expect(sampleNames.every((repoName) => TWENTY_TWO_REPOS.includes(repoName))).toBe(true);
  });

  it('stable sample is deterministic across calls', () => {
    const input = {
      github: {
        orgs: ['agent-workforce'],
        repoNames: TWENTY_TWO_REPOS,
      },
    };

    const firstContent = getContent(buildIntegrationsLayer(input));
    const secondContent = getContent(buildIntegrationsLayer(input));

    expect(getSampleLine(firstContent)).toBe(getSampleLine(secondContent));
  });

  it('empty items omits the line', () => {
    const result = buildIntegrationsLayer({
      github: { orgs: ['x'], repoNames: [] },
    });

    expect(result?.content ?? '').not.toContain('GitHub:');
  });

  it('mix of github + slack rendering', () => {
    const content = getContent(
      buildIntegrationsLayer({
        github: {
          orgs: ['agent-workforce'],
          repoNames: TWENTY_TWO_REPOS,
        },
        slack: {
          channels: SLACK_CHANNELS,
        },
      }),
    );

    expect(content).toContain('Workspace contains 22 repos.');
    expect(content).toContain(
      'NOT exhaustive — to enumerate, call workspace_list /github/repos',
    );
    expect(content).toContain(
      'Slack: Connected to the Slack workspace. Workspace contains channels: general, eng-builds, launches.',
    );
  });
});
