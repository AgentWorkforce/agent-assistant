import type { VfsEntry } from '@agent-assistant/vfs';

import { parseQuery } from './query-syntax.js';

export type LibrarianStatus = 'complete' | 'partial' | 'failed';
export type LibrarianSource = 'vfs-list' | 'vfs-enumerate' | 'vfs-search' | 'apiFallback' | 'mixed';

export interface LibrarianEvidence {
  id: string;
  kind: string;
  content: unknown;
}

export interface LibrarianAdapter<TType extends string = string> {
  capability: string;
  entityTypes: readonly TType[];
  listRoots(types: readonly TType[], filters: Record<string, string[]>): string[];
  inferFilters(text: string, filters: Record<string, string[]>): Record<string, string[]>;
  filterKeys: readonly string[];
  valuesForFilter(entry: VfsEntry, key: string): string[];
  inferEntityType(entry: VfsEntry): TType | 'unknown';
  toEvidence(entry: VfsEntry, type: TType | 'unknown'): LibrarianEvidence;
  searchProvider?: string;
  /**
   * Provider-aware search term for a given entity type. Used when list-based
   * enumeration comes back empty and the engine falls back to vfs.search.
   * Defaults to String(type) if unspecified; adapters should override when the
   * underlying index prefers a richer term (e.g. GitHub → "pull request" for "pr").
   */
  searchTerm?(type: TType): string;
}

export interface LibrarianVfs {
  list?(path: string, options?: { depth?: number; limit?: number }): Promise<readonly VfsEntry[]>;
  search?(query: string, options?: { provider?: string; limit?: number }): Promise<readonly VfsEntry[]>;
  /**
   * Optional metadata-bearing enumeration. Returns entries with `properties`
   * populated so the engine can filter by structured fields (state, label, type).
   * Providers without an indexed/property-aware backend leave this undefined.
   *
   * Filter semantics: OR within a key (any value matches), AND across keys
   * (all keys must match). Implementations MUST NOT silently drop unsupported
   * filter keys - return entries the engine can re-filter defensively, and
   * the engine WILL post-filter for correctness.
   *
   * Roots are normalized path prefixes (no globs in v1). Multiple roots are
   * legitimate for cross-repo / cross-collection enumeration; the provider
   * may batch internally.
   */
  enumerate?(input: {
    roots: string[];
    filters: Record<string, string[]>;
    limit: number;
  }): Promise<VfsEntry[]>;
}

export interface LibrarianFallbackRequest<TType extends string = string> {
  instruction: string;
  text: string;
  filters: Record<string, string[]>;
  types: TType[];
}

export type LibrarianApiFallback<TType extends string = string> =
  | ((request: LibrarianFallbackRequest<TType>) => Promise<readonly VfsEntry[]>)
  | {
      list?(request: LibrarianFallbackRequest<TType>): Promise<readonly VfsEntry[]>;
      search?(request: LibrarianFallbackRequest<TType>): Promise<readonly VfsEntry[]>;
    };

export interface LibrarianOptions<TType extends string = string> {
  vfs: LibrarianVfs;
  apiFallback?: LibrarianApiFallback<TType>;
  name?: string;
  description?: string;
  limit?: number;
  listDepth?: number;
  summaryLimit?: number;
}

export interface GenericLibrarianMetadata {
  text: string;
  filters: Record<string, string[]>;
  resultCount: number;
  source: LibrarianSource;
  errors?: string[];
}

export interface GenericLibrarianFindings {
  capability: string;
  status: LibrarianStatus;
  summary: string;
  evidence: LibrarianEvidence[];
  metadata: GenericLibrarianMetadata;
}

export interface GenericLibrarianSpecialist<TType extends string = string> {
  name: string;
  description: string;
  capabilities: string[];
  handler: {
    execute(instruction: string, context?: unknown): Promise<GenericLibrarianFindings>;
  };
}

interface EnumerationEntry<TType extends string> {
  entry: VfsEntry;
  enumerationType: TType | 'unknown';
}

const DEFAULT_LIMIT = 1_000;
const DEFAULT_LIST_DEPTH = 5;
const SUMMARY_LIMIT = 10;

export function createLibrarian<TType extends string>(
  adapter: LibrarianAdapter<TType>,
  options: LibrarianOptions<TType>,
): GenericLibrarianSpecialist<TType> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const listDepth = options.listDepth ?? DEFAULT_LIST_DEPTH;
  const summaryLimit = options.summaryLimit ?? SUMMARY_LIMIT;

  return {
    name: options.name ?? defaultSpecialistName(adapter.capability),
    description:
      options.description ?? `Enumerates ${adapter.capability} entities from VFS-backed metadata.`,
    capabilities: [adapter.capability],
    handler: {
      async execute(instruction: string): Promise<GenericLibrarianFindings> {
        const parsed = parseQuery(instruction);
        const filters = cloneFilters(adapter.inferFilters(parsed.text, cloneFilters(parsed.filters)));
        const types = requestedTypes(adapter, filters);
        const hasFilters = Object.values(filters).some((values) => values.length > 0);
        const errors: string[] = [];
        let source: LibrarianSource = 'vfs-list';
        let entries: EnumerationEntry<TType>[] = [];

        if (hasFilters && options.vfs.enumerate) {
          try {
            const enumerated = await options.vfs.enumerate({
              roots: adapter.listRoots(types, filters),
              filters,
              limit,
            });
            entries = enumerated.map((entry) => ({
              entry,
              enumerationType: adapter.inferEntityType(entry),
            }));
            source = 'vfs-enumerate';
          } catch (error) {
            errors.push(errorMessage(error));
          }
        } else if (options.vfs.list || options.vfs.search) {
          try {
            if (types.length > 0) {
              entries = await listEnumerationEntries(adapter, options.vfs, types, filters, errors, {
                limit,
                listDepth,
              });
            } else if (hasNoFilters(filters)) {
              entries = await searchEntries(adapter, options.vfs, parsed.text, errors, limit);
              source = 'vfs-search';
            } else {
              entries = await listEnumerationEntries(adapter, options.vfs, adapter.entityTypes, filters, errors, {
                limit,
                listDepth,
              });
            }
          } catch (error) {
            errors.push(errorMessage(error));
          }
        }

        if (entries.length === 0 && options.apiFallback) {
          try {
            const fallbackEntries = await loadFallbackEntries(options.apiFallback, {
              instruction,
              text: parsed.text,
              filters,
              types,
            });
            if (fallbackEntries.length > 0) {
              source = errors.length > 0 ? 'mixed' : 'apiFallback';
              entries = fallbackEntries.map((entry) => ({
                entry,
                enumerationType: adapter.inferEntityType(entry),
              }));
            }
          } catch (error) {
            errors.push(errorMessage(error));
          }
        }

        let matchedEntries = dedupeEntries(entries)
          .filter(({ entry }) => matchesRequestedFilters(adapter, entry, filters))
          .sort(compareEntries);

        if (hasFilters && matchedEntries.length === 0 && entries.length > 0 && options.apiFallback) {
          try {
            const fallbackEntries = await loadFallbackEntries(options.apiFallback, {
              instruction,
              text: parsed.text,
              filters,
              types,
            });
            if (fallbackEntries.length > 0) {
              const fallbackMatched = dedupeEntries(
                fallbackEntries.map((entry) => ({
                  entry,
                  enumerationType: adapter.inferEntityType(entry),
                })),
              )
                .filter(({ entry }) => matchesRequestedFilters(adapter, entry, filters))
                .sort(compareEntries);
              if (fallbackMatched.length > 0) {
                matchedEntries = fallbackMatched;
                source = errors.length > 0 ? 'mixed' : 'apiFallback';
              }
            }
          } catch (error) {
            errors.push(errorMessage(error));
          }
        }

        const evidence = matchedEntries.map(({ entry, enumerationType }) =>
          adapter.toEvidence(entry, enumerationType),
        );
        const status = statusFor(evidence.length, errors.length);

        return {
          capability: adapter.capability,
          status,
          summary: summarizeMatches(adapter.capability, evidence, summaryLimit),
          evidence,
          metadata: metadataFor(parsed.text, filters, evidence.length, source, errors),
        };
      },
    },
  };
}

function requestedTypes<TType extends string>(
  adapter: LibrarianAdapter<TType>,
  filters: Record<string, string[]>,
): TType[] {
  const requested = new Set(filters.type ?? []);
  if (requested.size === 0) {
    return [];
  }

  return adapter.entityTypes.filter((type) => requested.has(type));
}

function hasNoFilters(filters: Record<string, string[]>): boolean {
  return Object.values(filters).every((values) => values.length === 0) || Object.keys(filters).length === 0;
}

async function listEnumerationEntries<TType extends string>(
  adapter: LibrarianAdapter<TType>,
  vfs: LibrarianVfs,
  types: readonly TType[],
  filters: Record<string, string[]>,
  errors: string[],
  options: { limit: number; listDepth: number },
): Promise<EnumerationEntry<TType>[]> {
  const listedEntries: EnumerationEntry<TType>[] = [];

  if (vfs.list) {
    for (const root of adapter.listRoots(types, filters)) {
      try {
        const entries = await vfs.list(root, { depth: options.listDepth, limit: options.limit });
        listedEntries.push(...entries.flatMap((entry) => toEnumerationEntry(adapter, entry, types)));
      } catch (error) {
        errors.push(errorMessage(error));
      }
    }
  }

  if (listedEntries.length > 0 || !vfs.search) {
    return listedEntries;
  }

  try {
    const query = types.map((type) => (adapter.searchTerm ? adapter.searchTerm(type) : String(type))).join(' ');
    const results = await vfs.search(query, searchOptions(adapter, options.limit));
    return results.flatMap((entry) => toEnumerationEntry(adapter, entry, types));
  } catch (error) {
    errors.push(errorMessage(error));
    return [];
  }
}

async function searchEntries<TType extends string>(
  adapter: LibrarianAdapter<TType>,
  vfs: LibrarianVfs,
  text: string,
  errors: string[],
  limit: number,
): Promise<EnumerationEntry<TType>[]> {
  if (!vfs.search) {
    errors.push('VFS search is unavailable.');
    return [];
  }

  try {
    const results = await vfs.search(text.trim(), searchOptions(adapter, limit));
    return results.map((entry) => ({
      entry,
      enumerationType: adapter.inferEntityType(entry),
    }));
  } catch (error) {
    errors.push(errorMessage(error));
    return [];
  }
}

async function loadFallbackEntries<TType extends string>(
  apiFallback: LibrarianApiFallback<TType>,
  request: LibrarianFallbackRequest<TType>,
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

function toEnumerationEntry<TType extends string>(
  adapter: LibrarianAdapter<TType>,
  entry: VfsEntry,
  requested: readonly TType[],
): EnumerationEntry<TType>[] {
  const inferredType = adapter.inferEntityType(entry);
  if (inferredType === 'unknown') {
    return [];
  }
  if (!requested.includes(inferredType)) {
    return [];
  }

  return [{ entry, enumerationType: inferredType }];
}

function matchesRequestedFilters<TType extends string>(
  adapter: LibrarianAdapter<TType>,
  entry: VfsEntry,
  filters: Record<string, string[]>,
): boolean {
  return adapter.filterKeys.every((key) => filterMatches(adapter, entry, filters, key));
}

function filterMatches<TType extends string>(
  adapter: LibrarianAdapter<TType>,
  entry: VfsEntry,
  filters: Record<string, string[]>,
  key: string,
): boolean {
  const requested = filters[key];
  if (!requested || requested.length === 0) {
    return true;
  }

  const actual = adapter.valuesForFilter(entry, key).map((value) => normalizeComparable(value));
  return requested.some((value) => actual.includes(normalizeComparable(value)));
}

function metadataFor(
  text: string,
  filters: Record<string, string[]>,
  resultCount: number,
  source: LibrarianSource,
  errors: string[],
): GenericLibrarianMetadata {
  const metadata: GenericLibrarianMetadata = {
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

function statusFor(resultCount: number, errorCount: number): LibrarianStatus {
  if (resultCount > 0 && errorCount === 0) {
    return 'complete';
  }

  return resultCount > 0 ? 'partial' : 'failed';
}

function dedupeEntries<TType extends string>(entries: EnumerationEntry<TType>[]): EnumerationEntry<TType>[] {
  const seen = new Set<string>();
  const deduped: EnumerationEntry<TType>[] = [];

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

function compareEntries<TType extends string>(
  left: EnumerationEntry<TType>,
  right: EnumerationEntry<TType>,
): number {
  const leftUpdated = left.entry.updatedAt ?? '';
  const rightUpdated = right.entry.updatedAt ?? '';
  const updatedComparison = rightUpdated.localeCompare(leftUpdated);
  if (updatedComparison !== 0) {
    return updatedComparison;
  }

  return left.entry.path.localeCompare(right.entry.path);
}

function summarizeMatches(capability: string, evidence: LibrarianEvidence[], summaryLimit: number): string {
  if (evidence.length === 0) {
    return `No ${capability} enumeration matches found.`;
  }

  const lines = [`Found ${evidence.length} ${capability} enumeration match${evidence.length === 1 ? '' : 'es'}.`];
  for (const [index, item] of evidence.slice(0, summaryLimit).entries()) {
    lines.push(`${index + 1}. ${evidenceLabel(item)}`);
  }

  if (evidence.length > summaryLimit) {
    lines.push(`...and ${evidence.length - summaryLimit} more.`);
  }

  return lines.join('\n');
}

function evidenceLabel(evidence: LibrarianEvidence): string {
  if (!isRecord(evidence.content)) {
    return evidence.id;
  }

  const title =
    firstString(evidence.content.title, evidence.content.name, evidence.content.path, evidence.content.url) ??
    evidence.id;
  const scope = firstString(evidence.content.repo, evidence.content.repository, evidence.content.project);
  const state = firstString(evidence.content.state, evidence.content.status);
  const prefix = scope ? `${scope} - ${title}` : title;

  return state ? `${prefix} [${state}]` : prefix;
}

function searchOptions<TType extends string>(
  adapter: LibrarianAdapter<TType>,
  limit: number,
): { provider?: string; limit?: number } {
  const options: { provider?: string; limit?: number } = { limit };
  if (adapter.searchProvider) {
    options.provider = adapter.searchProvider;
  }

  return options;
}

function cloneFilters(filters: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(filters).map(([key, values]) => [key, [...values]]));
}

function normalizeComparable(value: string): string {
  return value.trim().toLowerCase();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultSpecialistName(capability: string): string {
  const prefix = capability.split('.')[0] ?? capability;
  return `${slugify(prefix)}-librarian`;
}

function slugify(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'generic';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}
