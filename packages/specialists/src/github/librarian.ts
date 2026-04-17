import type { VfsEntry } from '@agent-assistant/vfs';
import { GITHUB_PATH_ROOT, githubRepoPrefix } from '@relayfile/adapter-github/path-mapper';

import {
  createLibrarian,
  type GenericLibrarianFindings,
  type GenericLibrarianSpecialist,
  type LibrarianAdapter,
  type LibrarianApiFallback,
  type LibrarianFallbackRequest,
  type LibrarianStatus,
  type LibrarianVfs,
} from '../shared/librarian-engine.js';
import type { GitHubEnumerationParams } from './types.js';

type GitHubEnumerationType = 'pr' | 'issue';
type GitHubEnumerationCapability = 'github.enumerate';
const GITHUB_ENUMERATION_CAPABILITY: GitHubEnumerationCapability = 'github.enumerate';
type EnumerationStatus = LibrarianStatus;

type GitHubLibrarianVfs = LibrarianVfs;
type GitHubLibrarianFallbackRequest = LibrarianFallbackRequest<GitHubEnumerationType>;
type GitHubLibrarianApiFallback = LibrarianApiFallback<GitHubEnumerationType>;

export interface GitHubLibrarianOptions {
  vfs: GitHubLibrarianVfs;
  apiFallback?: GitHubLibrarianApiFallback;
}

export interface GitHubEnumerationEvidenceContent
  extends Partial<Record<'provider' | 'revision' | 'updatedAt' | 'url' | 'number' | 'snippet', string>> {
  type: GitHubEnumerationType | 'github';
  path: string;
  repo: string;
  title: string;
  state: string;
  labels: string[];
  properties: Record<string, string>;
}

export interface GitHubEnumerationEvidence {
  id: string;
  kind: 'enumeration_hit';
  content: GitHubEnumerationEvidenceContent;
}

export interface GitHubLibrarianFindings
  extends Omit<GenericLibrarianFindings, 'capability' | 'status' | 'evidence'> {
  capability: GitHubEnumerationCapability;
  status: EnumerationStatus;
  evidence: GitHubEnumerationEvidence[];
}

export interface GitHubLibrarianSpecialist
  extends Omit<GenericLibrarianSpecialist<GitHubEnumerationType>, 'name' | 'capabilities' | 'handler'> {
  name: 'github-librarian';
  capabilities: GitHubEnumerationCapability[];
  handler: {
    execute(instruction: string, context?: unknown): Promise<GitHubLibrarianFindings>;
  };
}

const COLLECTION_BY_TYPE: Record<GitHubEnumerationType, string> = { pr: 'pulls', issue: 'issues' };

const githubLibrarianAdapter: LibrarianAdapter<GitHubEnumerationType> = {
  capability: GITHUB_ENUMERATION_CAPABILITY,
  entityTypes: ['pr', 'issue'],
  filterKeys: ['state', 'repo', 'label', 'type'],
  searchProvider: 'github',
  listRoots(types, filters) {
    const repoFilters = filters.repo ?? [];
    if (repoFilters.length === 0) return [`${GITHUB_PATH_ROOT}/repos`];

    return repoFilters.flatMap((repoSlug) =>
      types.map((type) => {
        const [owner, repo] = repoSlug.split('/');
        return owner && repo
          ? `${githubRepoPrefix(owner, repo)}/${COLLECTION_BY_TYPE[type]}/`
          : `${GITHUB_PATH_ROOT}/repos/${repoSlug}/${COLLECTION_BY_TYPE[type]}/`;
      }),
    );
  },
  inferFilters: inferEnumerationFilters,
  valuesForFilter,
  inferEntityType,
  toEvidence,
  // "pr" alone is a weak search term for GitHub-indexed VFS stores; emit the
  // richer natural-language form so list-miss → vfs.search doesn't drop valid hits.
  searchTerm: (type) => (type === 'pr' ? 'pull request' : type),
};

export function createGitHubLibrarian({
  vfs,
  apiFallback,
}: GitHubLibrarianOptions): GitHubLibrarianSpecialist {
  const options = {
    vfs,
    name: 'github-librarian',
    description: 'Enumerates GitHub repositories, pull requests, and issues from VFS-backed metadata.',
  };
  const engine = createLibrarian(githubLibrarianAdapter, apiFallback ? { ...options, apiFallback } : options);
  return engine as unknown as GitHubLibrarianSpecialist;
}

export async function enumerateGitHub(
  params: GitHubEnumerationParams,
  options: GitHubLibrarianOptions,
): Promise<GitHubLibrarianFindings> {
  return createGitHubLibrarian(options).handler.execute(buildEnumerationInstruction(params));
}

function buildEnumerationInstruction(params: GitHubEnumerationParams): string {
  const parts = params.query?.trim() ? [params.query.trim()] : [];
  const filters = params.filters ?? {};
  for (const key of ['state', 'repo', 'label', 'type'] as const) {
    for (const value of filters[key] ?? []) parts.push(`${key}:${value}`);
  }
  return parts.join(' ').trim();
}

function inferEnumerationFilters(text: string, parsedFilters: Record<string, string[]>): Record<string, string[]> {
  const filters = cloneFilters(parsedFilters);
  const normalizedText = ` ${text.toLowerCase()} `;

  if (!filters.type?.length) {
    if (/\b(pr|prs|pull request|pull requests)\b/.test(normalizedText)) filters.type = ['pr'];
    else if (/\b(issue|issues)\b/.test(normalizedText)) filters.type = ['issue'];
  }
  if (!filters.state?.length) {
    if (/\bopen\b/.test(normalizedText)) filters.state = ['open'];
    else if (/\bclosed\b/.test(normalizedText)) filters.state = ['closed'];
  }
  if (!filters.label?.length) {
    const label = text.match(/\b(?:label|labeled|labelled)\s+["']?([^"'\s]+)["']?/i)?.[1];
    if (label) filters.label = [label];
  }

  return filters;
}

function valuesForFilter(entry: VfsEntry, key: string): string[] {
  const properties = entry.properties ?? {};
  if (key === 'repo') return [properties.repo, properties.repository, repoFromPath(entry.path)].filter(isString);
  if (key === 'label') return [...expandPropertyValues(properties.label), ...expandPropertyValues(properties.labels)];
  if (key === 'type') {
    const type = inferEntityType(entry);
    return [properties.type, type === 'unknown' ? undefined : type].filter(isString);
  }
  return expandPropertyValues(properties.state);
}

function inferEntityType(entry: VfsEntry): GitHubEnumerationType | 'unknown' {
  const propertyType = entry.properties?.type?.toLowerCase();
  if (propertyType === 'pr' || propertyType === 'pull_request' || propertyType === 'pull-request') return 'pr';
  if (propertyType === 'issue') return 'issue';
  return collectionItemTypeFromPath(entry.path) ?? 'unknown';
}

function toEvidence(entry: VfsEntry, type: GitHubEnumerationType | 'unknown'): GitHubEnumerationEvidence {
  const properties = entry.properties ?? {};
  const content: GitHubEnumerationEvidenceContent = {
    type: type === 'unknown' ? 'github' : type,
    path: entry.path,
    repo: firstString(properties.repo, properties.repository, repoFromPath(entry.path), 'unknown'),
    title: firstString(entry.title, properties.title, titleFromPath(entry.path)),
    state: firstString(properties.state, 'unknown'),
    labels: [...expandPropertyValues(properties.label), ...expandPropertyValues(properties.labels)],
    properties,
  };
  const number = firstString(properties.number, properties.pr, properties.issue, numberFromPath(entry.path));
  const snippet = snippetFromEntry(entry);

  for (const key of ['provider', 'revision', 'updatedAt'] as const) {
    const value = entry[key];
    if (value) content[key] = value;
  }
  if (properties.url) content.url = properties.url;
  if (number) content.number = number;
  if (snippet) content.snippet = snippet;

  return { id: firstString(properties.id, entry.path), kind: 'enumeration_hit', content };
}

function repoFromPath(path: string): string | undefined {
  const match = /\/repos\/([^/]+)\/([^/]+)/.exec(path);
  const owner = match?.[1];
  const repo = match?.[2];
  return owner && repo ? `${decodeSegment(owner)}/${decodeSegment(repo)}` : undefined;
}

function numberFromPath(path: string): string | undefined {
  const match = /\/repos\/[^/]+\/[^/]+\/(?:pulls|issues)\/([^/]+)/.exec(path);
  return match?.[1] ? decodeSegment(match[1]) : undefined;
}

function collectionItemTypeFromPath(path: string): GitHubEnumerationType | undefined {
  const match = /\/repos\/[^/]+\/[^/]+\/(pulls|issues)\/[^/]+/.exec(path);
  return match?.[1] === 'pulls' ? 'pr' : match?.[1] === 'issues' ? 'issue' : undefined;
}

function titleFromPath(path: string): string {
  return decodeSegment(path.split('/').filter(Boolean).at(-1) ?? path);
}

function expandPropertyValues(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter(isString).map((item) => item.trim()).filter(Boolean);
    } catch {
      // Fall through to comma-separated handling.
    }
  }
  return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
}

function cloneFilters(filters: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(filters).map(([key, values]) => [key, [...values]]));
}

function firstString(...values: Array<string | undefined>): string {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0) ?? '';
}

function snippetFromEntry(entry: VfsEntry): string | undefined {
  return 'snippet' in entry && typeof entry.snippet === 'string' ? entry.snippet : undefined;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
