import { createHash } from 'node:crypto';

const DEFAULT_MAX_INLINE_ITEMS = 8;
const DEFAULT_MAX_SAMPLE_ITEMS = 5;
const DEFAULT_SAMPLE_STRATEGY = 'stable-hash';

const GITHUB_ROOT = '/github/repos';
const SLACK_ROOT = '/slack/channels';
const NOTION_ROOT = '/notion/databases';

const MAX_GITHUB_ORG_SUMMARY_ITEMS = 3;

export interface IntegrationContextInput {
  github?: { orgs: string[]; repoNames: string[] };
  slack?: { channels: string[] };
  notion?: { databases: string[] };
}

export interface IntegrationLayerOptions {
  maxInlineItems?: number;
  maxSampleItems?: number;
  sampleStrategy?: 'first' | 'stable-hash';
}

export function buildIntegrationsLayer(
  input: IntegrationContextInput,
  opts?: IntegrationLayerOptions,
): { content: string } | null {
  const options = normalizeOptions(opts);
  const lines = [
    buildGitHubLine(input.github, options),
    buildSurfaceLine(
      'Slack',
      'the Slack workspace',
      input.slack?.channels ?? [],
      SLACK_ROOT,
      { pluralLabel: 'channels' },
      options,
    ),
    buildSurfaceLine(
      'Notion',
      'the Notion workspace',
      input.notion?.databases ?? [],
      NOTION_ROOT,
      { pluralLabel: 'databases' },
      options,
    ),
  ].filter((line): line is string => line !== null);

  if (lines.length === 0) {
    return null;
  }

  return { content: lines.join('\n') };
}

interface NormalizedOptions {
  maxInlineItems: number;
  maxSampleItems: number;
  sampleStrategy: 'first' | 'stable-hash';
}

interface SurfaceDescriptor {
  pluralLabel: string;
}

function buildGitHubLine(
  github: IntegrationContextInput['github'],
  options: NormalizedOptions,
): string | null {
  const repoNames = normalizeItems(github?.repoNames ?? []);
  if (repoNames.length === 0) {
    return null;
  }

  return buildSurfaceLine(
    'GitHub',
    summarizeGitHubOrgs(github?.orgs ?? []),
    repoNames,
    GITHUB_ROOT,
    { pluralLabel: 'repos' },
    options,
  );
}

function buildSurfaceLine(
  label: string,
  connectionSummary: string,
  items: string[],
  root: string,
  descriptor: SurfaceDescriptor,
  options: NormalizedOptions,
): string | null {
  const normalizedItems = normalizeItems(items);
  if (normalizedItems.length === 0) {
    return null;
  }

  if (normalizedItems.length <= options.maxInlineItems) {
    return `${label}: Connected to ${connectionSummary}. Workspace contains ${descriptor.pluralLabel}: ${normalizedItems.join(', ')}.`;
  }

  const sample = selectSample(normalizedItems, options);

  return [
    `${label}: Connected to ${connectionSummary}. Workspace contains ${normalizedItems.length} ${descriptor.pluralLabel}.`,
    `  This list is NOT exhaustive — to enumerate, call workspace_list ${root}.`,
    `  Sample: ${sample.length > 0 ? sample.join(', ') : 'none'}.`,
  ].join('\n');
}

function summarizeGitHubOrgs(orgs: string[]): string {
  const normalizedOrgs = normalizeItems(orgs);
  if (normalizedOrgs.length === 0) {
    return 'the GitHub workspace';
  }

  if (normalizedOrgs.length === 1) {
    return `GitHub org ${normalizedOrgs[0]}`;
  }

  const visibleOrgs = normalizedOrgs.slice(0, MAX_GITHUB_ORG_SUMMARY_ITEMS);
  if (normalizedOrgs.length <= MAX_GITHUB_ORG_SUMMARY_ITEMS) {
    return `GitHub orgs ${visibleOrgs.join(', ')}`;
  }

  return `${normalizedOrgs.length} GitHub orgs including ${visibleOrgs.join(', ')}`;
}

function selectSample(items: string[], options: NormalizedOptions): string[] {
  if (options.maxSampleItems === 0) {
    return [];
  }

  if (options.sampleStrategy === 'first') {
    return items.slice(0, options.maxSampleItems);
  }

  return [...items]
    .sort((left, right) => compareStableHashes(left, right) || left.localeCompare(right))
    .slice(0, options.maxSampleItems);
}

function compareStableHashes(left: string, right: string): number {
  return stableHashPrefix(left).localeCompare(stableHashPrefix(right));
}

function stableHashPrefix(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

function normalizeItems(items: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function normalizeOptions(opts?: IntegrationLayerOptions): NormalizedOptions {
  return {
    maxInlineItems: normalizeCount(opts?.maxInlineItems, DEFAULT_MAX_INLINE_ITEMS),
    maxSampleItems: normalizeCount(opts?.maxSampleItems, DEFAULT_MAX_SAMPLE_ITEMS),
    sampleStrategy: normalizeSampleStrategy(opts?.sampleStrategy),
  };
}

function normalizeSampleStrategy(
  strategy: IntegrationLayerOptions['sampleStrategy'] | undefined,
): 'first' | 'stable-hash' {
  if (strategy === 'first' || strategy === 'stable-hash') {
    return strategy;
  }

  return DEFAULT_SAMPLE_STRATEGY;
}

function normalizeCount(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.floor(value);
}
