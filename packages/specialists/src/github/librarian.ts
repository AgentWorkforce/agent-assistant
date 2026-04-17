import type { VfsEntry } from '@agent-assistant/vfs';
import {
  GITHUB_PATH_ROOT,
  githubRepoPrefix,
} from '@relayfile/adapter-github/path-mapper';

import { parseQuery } from '../shared/query-syntax.js';
import type { GitHubEnumerationParams } from './types.js';

type GitHubEnumerationType = 'pr' | 'issue';
// Canonical capability literal matches types.ts GitHubEnumerationParams.capability
// so routing/correlation keys line up across request and findings.
type GitHubEnumerationCapability = 'github.enumerate';
const GITHUB_ENUMERATION_CAPABILITY: GitHubEnumerationCapability = 'github.enumerate';
type EnumerationStatus = 'complete' | 'partial' | 'failed';

interface GitHubLibrarianVfs {
  list?(path: string, options?: { depth?: number; limit?: number }): Promise<readonly VfsEntry[]>;
  search?(query: string, options?: { provider?: string; limit?: number }): Promise<readonly VfsEntry[]>;
}

interface GitHubLibrarianFallbackRequest {
  instruction: string;
  text: string;
  filters: Record<string, string[]>;
  types: GitHubEnumerationType[];
}

type GitHubLibrarianApiFallback =
  | ((request: GitHubLibrarianFallbackRequest) => Promise<readonly VfsEntry[]>)
  | {
      list?(request: GitHubLibrarianFallbackRequest): Promise<readonly VfsEntry[]>;
      search?(request: GitHubLibrarianFallbackRequest): Promise<readonly VfsEntry[]>;
    };

export interface GitHubLibrarianOptions {
  vfs: GitHubLibrarianVfs;
  apiFallback?: GitHubLibrarianApiFallback;
}

export interface GitHubEnumerationEvidenceContent {
  type: GitHubEnumerationType | 'github';
  path: string;
  repo: string;
  title: string;
  state: string;
  labels: string[];
  properties: Record<string, string>;
  provider?: string;
  revision?: string;
  updatedAt?: string;
  url?: string;
  number?: string;
  snippet?: string;
}

export interface GitHubEnumerationEvidence {
  id: string;
  kind: 'enumeration_hit';
  content: GitHubEnumerationEvidenceContent;
}

export interface GitHubLibrarianFindings {
  capability: GitHubEnumerationCapability;
  status: EnumerationStatus;
  summary: string;
  evidence: GitHubEnumerationEvidence[];
  metadata: {
    text: string;
    filters: Record<string, string[]>;
    resultCount: number;
    source: 'vfs' | 'apiFallback' | 'mixed';
    errors?: string[];
  };
}

export interface GitHubLibrarianSpecialist {
  name: 'github-librarian';
  description: string;
  capabilities: GitHubEnumerationCapability[];
  handler: {
    execute(instruction: string, context?: unknown): Promise<GitHubLibrarianFindings>;
  };
}

interface EnumerationEntry {
  entry: VfsEntry;
  enumerationType: GitHubEnumerationType | 'github';
}

const DEFAULT_LIMIT = 1_000;
const SUMMARY_LIMIT = 10;
const GITHUB_PROVIDER = 'github';
const COLLECTION_BY_TYPE: Record<GitHubEnumerationType, string> = {
  pr: 'pulls',
  issue: 'issues',
};

export function createGitHubLibrarian({
  vfs,
  apiFallback,
}: GitHubLibrarianOptions): GitHubLibrarianSpecialist {
  return {
    name: 'github-librarian',
    description: 'Enumerates GitHub repositories, pull requests, and issues from VFS-backed metadata.',
    capabilities: [GITHUB_ENUMERATION_CAPABILITY],
    handler: {
      async execute(instruction: string): Promise<GitHubLibrarianFindings> {
        const parsed = parseQuery(instruction);
        const filters = inferEnumerationFilters(parsed.text, parsed.filters);
        const types = requestedTypes(filters);
        const errors: string[] = [];
        let source: GitHubLibrarianFindings['metadata']['source'] = 'vfs';
        let entries: EnumerationEntry[] = [];

        try {
          if (types.length > 0) {
            entries = await listEnumerationEntries(vfs, types, filters, errors);
          } else if (hasNoFilters(filters)) {
            entries = await searchGitHub(vfs, parsed.text, errors);
          } else {
            entries = await listEnumerationEntries(vfs, ['pr', 'issue'], filters, errors);
          }
        } catch (error) {
          errors.push(errorMessage(error));
        }

        if (entries.length === 0 && apiFallback) {
          try {
            const fallbackEntries = await loadFallbackEntries(apiFallback, {
              instruction,
              text: parsed.text,
              filters,
              types,
            });
            if (fallbackEntries.length > 0) {
              source = errors.length > 0 ? 'mixed' : 'apiFallback';
              entries = fallbackEntries.map((entry) => ({
                entry,
                enumerationType: inferEnumerationType(entry),
              }));
            }
          } catch (error) {
            // Mirror the VFS error-handling pattern so a failing apiFallback
            // never crashes the handler — surface via errors + 'failed' status.
            errors.push(errorMessage(error));
          }
        }

        const matchedEntries = dedupeEntries(entries)
          .filter(({ entry }) => matchesRequestedFilters(entry, filters))
          .sort(compareEntries);
        const evidence = matchedEntries.map(({ entry, enumerationType }) => toEvidence(entry, enumerationType));
        const status = statusFor(evidence.length, errors.length);

        return {
          capability: GITHUB_ENUMERATION_CAPABILITY,
          status,
          summary: summarizeMatches(evidence),
          evidence,
          metadata: metadataFor(parsed.text, filters, evidence.length, source, errors),
        };
      },
    },
  };
}

// Functional counterpart to investigateGitHub — runs the librarian handler
// for callers that have params + deps but don't want to instantiate a
// Specialist. Uses params.query as the instruction when present.
export async function enumerateGitHub(
  params: GitHubEnumerationParams,
  options: GitHubLibrarianOptions,
): Promise<GitHubLibrarianFindings> {
  const librarian = createGitHubLibrarian(options);
  const instruction = buildEnumerationInstruction(params);
  return librarian.handler.execute(instruction);
}

function buildEnumerationInstruction(params: GitHubEnumerationParams): string {
  const parts: string[] = [];
  if (params.query && params.query.trim()) {
    parts.push(params.query.trim());
  }

  const filters = params.filters ?? {};
  for (const key of ['state', 'repo', 'label', 'type'] as const) {
    const values = filters[key];
    if (!values || values.length === 0) {
      continue;
    }
    for (const value of values) {
      parts.push(`${key}:${value}`);
    }
  }

  return parts.join(' ').trim();
}

function inferEnumerationFilters(text: string, parsedFilters: Record<string, string[]>): Record<string, string[]> {
  const filters = cloneFilters(parsedFilters);
  const normalizedText = ` ${text.toLowerCase()} `;

  if (!filters.type || filters.type.length === 0) {
    if (/\b(pr|prs|pull request|pull requests)\b/.test(normalizedText)) {
      filters.type = ['pr'];
    } else if (/\b(issue|issues)\b/.test(normalizedText)) {
      filters.type = ['issue'];
    }
  }

  if (!filters.state || filters.state.length === 0) {
    if (/\bopen\b/.test(normalizedText)) {
      filters.state = ['open'];
    } else if (/\bclosed\b/.test(normalizedText)) {
      filters.state = ['closed'];
    }
  }

  if (!filters.label || filters.label.length === 0) {
    const label = text.match(/\b(?:label|labeled|labelled)\s+["']?([^"'\s]+)["']?/i)?.[1];
    if (label) {
      filters.label = [label];
    }
  }

  return filters;
}

function cloneFilters(filters: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(filters).map(([key, values]) => [key, [...values]]));
}

function requestedTypes(filters: Record<string, string[]>): GitHubEnumerationType[] {
  const values = filters.type ?? [];
  const types: GitHubEnumerationType[] = [];

  if (values.includes('pr')) {
    types.push('pr');
  }
  if (values.includes('issue')) {
    types.push('issue');
  }

  return types;
}

function hasNoFilters(filters: Record<string, string[]>): boolean {
  return Object.values(filters).every((values) => values.length === 0) || Object.keys(filters).length === 0;
}

async function listEnumerationEntries(
  vfs: GitHubLibrarianVfs,
  types: GitHubEnumerationType[],
  filters: Record<string, string[]>,
  errors: string[],
): Promise<EnumerationEntry[]> {
  const listedEntries: EnumerationEntry[] = [];

  if (vfs.list) {
    const repoFilters = filters.repo ?? [];
    const listRoots =
      repoFilters.length > 0
        ? repoFilters.flatMap((repoSlug) =>
            types.map((type) => {
              const [owner, repo] = repoSlug.split('/');
              // Fall back to raw path if the slug isn't owner/name shaped.
              if (!owner || !repo) {
                return `${GITHUB_PATH_ROOT}/repos/${repoSlug}/${COLLECTION_BY_TYPE[type]}/`;
              }
              return `${githubRepoPrefix(owner, repo)}/${COLLECTION_BY_TYPE[type]}/`;
            }),
          )
        : [`${GITHUB_PATH_ROOT}/repos`];

    for (const root of listRoots) {
      try {
        const entries = await vfs.list(root, { depth: repoFilters.length > 0 ? 2 : 5, limit: DEFAULT_LIMIT });
        listedEntries.push(...entries.flatMap((entry) => toEnumerationEntry(entry, types)));
      } catch (error) {
        errors.push(errorMessage(error));
      }
    }
  }

  if (listedEntries.length > 0 || !vfs.search) {
    return listedEntries;
  }

  const searchQuery = types.map((type) => (type === 'pr' ? 'pull request' : 'issue')).join(' ');
  try {
    const results = await vfs.search(searchQuery, { provider: GITHUB_PROVIDER, limit: DEFAULT_LIMIT });
    return results.flatMap((entry) => toEnumerationEntry(entry, types));
  } catch (error) {
    errors.push(errorMessage(error));
    return [];
  }
}

async function searchGitHub(
  vfs: GitHubLibrarianVfs,
  text: string,
  errors: string[],
): Promise<EnumerationEntry[]> {
  if (!vfs.search) {
    errors.push('VFS search is unavailable.');
    return [];
  }

  try {
    const results = await vfs.search(text.trim(), { provider: GITHUB_PROVIDER, limit: DEFAULT_LIMIT });
    return results.map((entry) => ({
      entry,
      enumerationType: inferEnumerationType(entry),
    }));
  } catch (error) {
    errors.push(errorMessage(error));
    return [];
  }
}

async function loadFallbackEntries(
  apiFallback: GitHubLibrarianApiFallback,
  request: GitHubLibrarianFallbackRequest,
): Promise<readonly VfsEntry[]> {
  if (typeof apiFallback === 'function') {
    return apiFallback(request);
  }

  if (request.types.length > 0 && apiFallback.list) {
    return apiFallback.list(request);
  }

  if (apiFallback.search) {
    return apiFallback.search(request);
  }

  if (apiFallback.list) {
    return apiFallback.list(request);
  }

  return [];
}

function toEnumerationEntry(entry: VfsEntry, requested: GitHubEnumerationType[]): EnumerationEntry[] {
  const inferredType = inferEnumerationType(entry);
  if (inferredType === 'github') {
    return [];
  }
  if (!requested.includes(inferredType)) {
    return [];
  }

  return [{ entry, enumerationType: inferredType }];
}

function inferEnumerationType(entry: VfsEntry): GitHubEnumerationType | 'github' {
  const propertyType = entry.properties?.type?.toLowerCase();
  if (propertyType === 'pr' || propertyType === 'pull_request' || propertyType === 'pull-request') {
    return 'pr';
  }
  if (propertyType === 'issue') {
    return 'issue';
  }

  return collectionItemTypeFromPath(entry.path) ?? 'github';
}

function matchesRequestedFilters(entry: VfsEntry, filters: Record<string, string[]>): boolean {
  return filterMatches(entry, filters, 'state') && filterMatches(entry, filters, 'repo') && filterMatches(entry, filters, 'label');
}

function filterMatches(entry: VfsEntry, filters: Record<string, string[]>, key: 'state' | 'repo' | 'label'): boolean {
  const requested = filters[key];
  if (!requested || requested.length === 0) {
    return true;
  }

  const actual = valuesForFilter(entry, key).map((value) => normalizeComparable(value));
  return requested.some((value) => actual.includes(normalizeComparable(value)));
}

function valuesForFilter(entry: VfsEntry, key: 'state' | 'repo' | 'label'): string[] {
  const properties = entry.properties ?? {};

  if (key === 'repo') {
    return [properties.repo, properties.repository, repoFromPath(entry.path)].filter(isString);
  }

  if (key === 'label') {
    return [
      ...expandPropertyValues(properties.label),
      ...expandPropertyValues(properties.labels),
    ];
  }

  return expandPropertyValues(properties.state);
}

function toEvidence(entry: VfsEntry, enumerationType: GitHubEnumerationType | 'github'): GitHubEnumerationEvidence {
  const properties = entry.properties ?? {};
  const labels = [
    ...expandPropertyValues(properties.label),
    ...expandPropertyValues(properties.labels),
  ];
  const content: GitHubEnumerationEvidenceContent = {
    type: enumerationType,
    path: entry.path,
    repo: firstString(properties.repo, properties.repository, repoFromPath(entry.path), 'unknown'),
    title: firstString(entry.title, properties.title, titleFromPath(entry.path)),
    state: firstString(properties.state, 'unknown'),
    labels,
    properties,
  };
  const number = firstString(properties.number, properties.pr, properties.issue, numberFromPath(entry.path));
  const snippet = snippetFromEntry(entry);

  if (entry.provider) {
    content.provider = entry.provider;
  }
  if (entry.revision) {
    content.revision = entry.revision;
  }
  if (entry.updatedAt) {
    content.updatedAt = entry.updatedAt;
  }
  if (properties.url) {
    content.url = properties.url;
  }
  if (number !== '') {
    content.number = number;
  }
  if (snippet) {
    content.snippet = snippet;
  }

  return {
    id: firstString(properties.id, entry.path),
    kind: 'enumeration_hit',
    content,
  };
}

function summarizeMatches(evidence: GitHubEnumerationEvidence[]): string {
  if (evidence.length === 0) {
    return 'No GitHub enumeration matches found.';
  }

  const lines = [`Found ${evidence.length} GitHub enumeration match${evidence.length === 1 ? '' : 'es'}.`];
  for (const [index, item] of evidence.slice(0, SUMMARY_LIMIT).entries()) {
    lines.push(`${index + 1}. ${item.content.repo} - ${item.content.title} [${item.content.state}]`);
  }

  if (evidence.length > SUMMARY_LIMIT) {
    lines.push(`...and ${evidence.length - SUMMARY_LIMIT} more.`);
  }

  return lines.join('\n');
}

function metadataFor(
  text: string,
  filters: Record<string, string[]>,
  resultCount: number,
  source: GitHubLibrarianFindings['metadata']['source'],
  errors: string[],
): GitHubLibrarianFindings['metadata'] {
  const metadata: GitHubLibrarianFindings['metadata'] = {
    text,
    filters,
    resultCount,
    source,
  };

  if (errors.length > 0) {
    metadata.errors = errors;
  }

  return metadata;
}

function statusFor(resultCount: number, errorCount: number): EnumerationStatus {
  if (errorCount === 0) {
    return 'complete';
  }

  return resultCount > 0 ? 'partial' : 'failed';
}

function dedupeEntries(entries: EnumerationEntry[]): EnumerationEntry[] {
  const seen = new Set<string>();
  const deduped: EnumerationEntry[] = [];

  for (const item of entries) {
    const key = item.entry.path;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function compareEntries(left: EnumerationEntry, right: EnumerationEntry): number {
  const leftUpdated = left.entry.updatedAt ?? '';
  const rightUpdated = right.entry.updatedAt ?? '';
  const updatedComparison = rightUpdated.localeCompare(leftUpdated);
  if (updatedComparison !== 0) {
    return updatedComparison;
  }

  return left.entry.path.localeCompare(right.entry.path);
}

function expandPropertyValues(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter(isString).map((item) => item.trim()).filter((item) => item.length > 0);
      }
    } catch {
      // Fall through to comma-separated handling.
    }
  }

  return trimmed.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
}

function repoFromPath(path: string): string | undefined {
  const segments = pathSegments(path);
  const reposIndex = segments.indexOf('repos');
  if (reposIndex < 0) {
    return undefined;
  }

  const owner = segments[reposIndex + 1];
  const repo = segments[reposIndex + 2];
  if (!owner || !repo) {
    return undefined;
  }

  return `${owner}/${repo}`;
}

function numberFromPath(path: string): string | undefined {
  const segments = pathSegments(path);
  const collectionIndex = collectionIndexFromPath(path);
  if (collectionIndex < 0) {
    return undefined;
  }

  return segments[collectionIndex + 1];
}

function collectionItemTypeFromPath(path: string): GitHubEnumerationType | undefined {
  const segments = pathSegments(path);
  const collectionIndex = collectionIndexFromPath(path);
  if (collectionIndex < 0 || !segments[collectionIndex + 1]) {
    return undefined;
  }

  if (segments[collectionIndex] === 'pulls') {
    return 'pr';
  }

  if (segments[collectionIndex] === 'issues') {
    return 'issue';
  }

  return undefined;
}

function collectionIndexFromPath(path: string): number {
  const segments = pathSegments(path);
  const reposIndex = segments.indexOf('repos');
  if (reposIndex < 0) {
    return -1;
  }

  const collectionIndex = reposIndex + 3;
  const collection = segments[collectionIndex];
  return collection === 'pulls' || collection === 'issues' ? collectionIndex : -1;
}

function titleFromPath(path: string): string {
  const segments = pathSegments(path);
  return segments[segments.length - 1] ?? path;
}

function pathSegments(path: string): string[] {
  return path.split('/').filter(Boolean).map(decodeSegment);
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function normalizeComparable(value: string): string {
  return value.trim().toLowerCase();
}

function firstString(...values: Array<string | undefined>): string {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0) ?? '';
}

function snippetFromEntry(entry: VfsEntry): string | undefined {
  if ('snippet' in entry && typeof entry.snippet === 'string') {
    return entry.snippet;
  }

  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
