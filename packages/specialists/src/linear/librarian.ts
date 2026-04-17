import type { VfsEntry } from '@agent-assistant/vfs';
import {
  linearCommentPath,
  linearIssuePath,
  linearProjectPath,
} from '@relayfile/adapter-linear/path-mapper';

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
import type { LinearEntityType, LinearEnumerationCapability } from './types.js';

const LINEAR_ENUMERATION_CAPABILITY: LinearEnumerationCapability = 'linear.enumerate';
type EnumerationStatus = LibrarianStatus;
const LINEAR_FILTER_KEYS = ['state', 'team', 'assignee', 'priority', 'project', 'type'] as const;
const LINEAR_ENTITY_TYPES = new Set<string>(['issue', 'project', 'comment']);

type LinearLibrarianVfs = LibrarianVfs;
type LinearLibrarianFallbackRequest = LibrarianFallbackRequest<LinearEntityType>;
type LinearLibrarianApiFallback = LibrarianApiFallback<LinearEntityType>;

export interface LinearLibrarianOptions {
  vfs: LinearLibrarianVfs;
  apiFallback?: LinearLibrarianApiFallback;
}

export interface LinearEnumerationEvidenceContent
  extends Partial<
    Record<
      | 'provider'
      | 'revision'
      | 'updatedAt'
      | 'createdAt'
      | 'url'
      | 'identifier'
      | 'number'
      | 'issue'
      | 'author'
      | 'snippet',
      string
    >
  > {
  type: LinearEntityType | 'linear';
  path: string;
  title: string;
  state: string;
  team: string;
  assignee: string;
  priority: string;
  project: string;
  properties: Record<string, string>;
}

export interface LinearEnumerationEvidence {
  id: string;
  kind: 'enumeration_hit';
  content: LinearEnumerationEvidenceContent;
}

export interface LinearLibrarianFindings
  extends Omit<GenericLibrarianFindings, 'capability' | 'status' | 'evidence'> {
  capability: LinearEnumerationCapability;
  status: EnumerationStatus;
  evidence: LinearEnumerationEvidence[];
}

export interface LinearLibrarianSpecialist
  extends Omit<GenericLibrarianSpecialist<LinearEntityType>, 'name' | 'capabilities' | 'handler'> {
  name: 'linear-librarian';
  capabilities: LinearEnumerationCapability[];
  handler: {
    execute(instruction: string, context?: unknown): Promise<LinearLibrarianFindings>;
  };
}

const COLLECTION_ROOT_BY_TYPE: Record<LinearEntityType, string> = {
  issue: collectionRootFromPath(linearIssuePath('__root__')),
  project: collectionRootFromPath(linearProjectPath('__root__')),
  comment: collectionRootFromPath(linearCommentPath('__root__')),
};

const linearLibrarianAdapter: LibrarianAdapter<LinearEntityType> = {
  capability: LINEAR_ENUMERATION_CAPABILITY,
  entityTypes: ['issue', 'project', 'comment'],
  filterKeys: ['state', 'team', 'assignee', 'priority', 'project'],
  searchProvider: 'linear',
  listRoots(types) {
    return types.map((type) => COLLECTION_ROOT_BY_TYPE[type]);
  },
  inferFilters: inferEnumerationFilters,
  valuesForFilter,
  inferEntityType,
  toEvidence,
};

export function createLinearLibrarian({
  vfs,
  apiFallback,
}: LinearLibrarianOptions): LinearLibrarianSpecialist {
  const options = {
    vfs,
    name: 'linear-librarian',
    description: 'Enumerates Linear issues, projects, and comments from VFS-backed metadata.',
  };
  const engine = createLibrarian(linearLibrarianAdapter, apiFallback ? { ...options, apiFallback } : options);
  return engine as unknown as LinearLibrarianSpecialist;
}

function inferEnumerationFilters(text: string, parsedFilters: Record<string, string[]>): Record<string, string[]> {
  const filters = cloneFilters(parsedFilters);
  inferExplicitFilters(text, filters);
  const normalizedText = ` ${text.toLowerCase().replace(/[-_]+/g, ' ')} `;

  if (!filters.type?.length) {
    if (/\b(issue|issues)\b/.test(normalizedText)) filters.type = ['issue'];
    else if (/\b(project|projects)\b/.test(normalizedText)) filters.type = ['project'];
    else if (/\b(comment|comments)\b/.test(normalizedText)) filters.type = ['comment'];
  }
  if (!filters.state?.length) {
    if (/\bin progress\b/.test(normalizedText)) filters.state = ['in progress'];
    else if (/\bcancell?ed\b/.test(normalizedText)) filters.state = ['cancelled'];
    else if (/\bopen\b/.test(normalizedText)) filters.state = ['open'];
    else if (/\bdone\b/.test(normalizedText)) filters.state = ['done'];
  }
  if (!filters.team?.length) {
    const team = cueValue(text, /\bteam\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
    if (team) filters.team = [team];
  }
  if (!filters.assignee?.length) {
    const assignee = cueValue(text, /\bassigned\s+to\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
    if (assignee) filters.assignee = [assignee];
  }
  if (!filters.priority?.length) {
    const priority = text.match(/\bpriority\s+(high|medium|low)\b/i)?.[1];
    if (priority) filters.priority = [priority];
  }

  return filters;
}

function inferExplicitFilters(text: string, filters: Record<string, string[]>): void {
  for (const token of text.trim().split(/\s+/)) {
    if (!token) continue;

    const separatorIndex = token.indexOf(':');
    if (separatorIndex <= 0 || separatorIndex === token.length - 1) continue;

    const key = token.slice(0, separatorIndex).toLowerCase();
    if (!LINEAR_FILTER_KEYS.includes(key as (typeof LINEAR_FILTER_KEYS)[number])) continue;

    const value = normalizeExplicitFilterValue(key, token.slice(separatorIndex + 1));
    if (!value) continue;

    const existing = filters[key] ?? [];
    if (!existing.includes(value)) filters[key] = [...existing, value];
  }
}

function normalizeExplicitFilterValue(key: string, value: string): string | undefined {
  const trimmed = unquote(value.replace(/[,.]$/g, '').trim());
  if (!trimmed) return undefined;

  if (key === 'type') {
    const normalizedType = trimmed.toLowerCase();
    return LINEAR_ENTITY_TYPES.has(normalizedType) ? normalizedType : undefined;
  }

  if (key === 'state') {
    return trimmed.toLowerCase().replace(/[-_]+/g, ' ');
  }

  return trimmed;
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function valuesForFilter(entry: VfsEntry, key: string): string[] {
  const properties = entry.properties ?? {};
  if (key === 'state') {
    return expandStateValues(properties.state, properties.status, properties.stateName);
  }
  if (key === 'team') {
    return expandPropertyValues(
      properties.team,
      properties.teamId,
      properties.teamKey,
      properties.teamName,
      properties.teamSlug,
    );
  }
  if (key === 'assignee') {
    return expandPropertyValues(
      properties.assignee,
      properties.assigneeId,
      properties.assigneeName,
      properties.assigneeEmail,
      properties.assigneeUsername,
    );
  }
  if (key === 'priority') {
    return expandPropertyValues(properties.priority, properties.priorityLabel, properties.priorityName);
  }
  if (key === 'project') {
    return expandPropertyValues(
      properties.project,
      properties.projectId,
      properties.projectKey,
      properties.projectName,
      properties.projectSlug,
    );
  }
  if (key === 'type') {
    const type = inferEntityType(entry);
    return [properties.type, type === 'unknown' ? undefined : type].filter(isString);
  }
  return [];
}

function inferEntityType(entry: VfsEntry): LinearEntityType | 'unknown' {
  const propertyType = firstString(
    entry.properties?.type,
    entry.properties?.objectType,
    entry.properties?.entityType,
  )
    .toLowerCase()
    .replace(/[-_\s]+/g, '');

  if (propertyType === 'issue' || propertyType === 'linearissue') return 'issue';
  if (propertyType === 'project' || propertyType === 'linearproject') return 'project';
  if (propertyType === 'comment' || propertyType === 'linearcomment') return 'comment';
  return collectionItemTypeFromPath(entry.path) ?? 'unknown';
}

function toEvidence(entry: VfsEntry, type: LinearEntityType | 'unknown'): LinearEnumerationEvidence {
  const properties = entry.properties ?? {};
  const content: LinearEnumerationEvidenceContent = {
    type: type === 'unknown' ? 'linear' : type,
    path: entry.path,
    title: firstString(entry.title, properties.title, properties.name, properties.identifier, idFromPath(entry.path)),
    state: firstString(properties.state, properties.status, properties.stateName, 'unknown'),
    team: firstString(properties.team, properties.teamName, properties.teamKey, properties.teamId),
    assignee: firstString(
      properties.assignee,
      properties.assigneeName,
      properties.assigneeEmail,
      properties.assigneeId,
    ),
    priority: firstString(properties.priority, properties.priorityLabel, properties.priorityName),
    project: firstString(properties.project, properties.projectName, properties.projectId),
    properties,
  };
  const id = firstString(properties.id, properties.identifier, properties.key, idFromPath(entry.path), entry.path);
  const identifier = firstString(properties.identifier, properties.key, idFromPath(entry.path));
  const issue = firstString(properties.issue, properties.issueIdentifier, properties.issueId);
  const snippet = snippetFromEntry(entry);

  for (const key of ['provider', 'revision', 'updatedAt'] as const) {
    const value = entry[key];
    if (value) content[key] = value;
  }
  for (const key of ['createdAt', 'url', 'number', 'author'] as const) {
    const value = properties[key];
    if (value) content[key] = value;
  }
  if (identifier) content.identifier = identifier;
  if (issue) content.issue = issue;
  if (snippet) content.snippet = snippet;

  return { id, kind: 'enumeration_hit', content };
}

function collectionRootFromPath(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  return lastSlash >= 0 ? path.slice(0, lastSlash + 1) : path;
}

function collectionItemTypeFromPath(path: string): LinearEntityType | undefined {
  const match = /\/linear\/(issues|projects|comments)\/[^/]+(?:\.json)?$/.exec(path);
  if (match?.[1] === 'issues') return 'issue';
  if (match?.[1] === 'projects') return 'project';
  if (match?.[1] === 'comments') return 'comment';
  return undefined;
}

function idFromPath(path: string): string | undefined {
  const leaf = path.split('/').filter(Boolean).at(-1);
  if (!leaf) return undefined;
  return decodeSegment(leaf.replace(/\.json$/i, ''));
}

function expandStateValues(...values: Array<string | undefined>): string[] {
  return unique(expandPropertyValues(...values).flatMap(stateValueVariants));
}

function stateValueVariants(value: string): string[] {
  const normalized = value.trim().toLowerCase().replace(/[-_]+/g, ' ');
  const variants = [value, normalized];

  if (normalized === 'in progress') {
    variants.push('in_progress', 'in-progress');
  }
  if (normalized === 'cancelled' || normalized === 'canceled') {
    variants.push('cancelled', 'canceled');
  }

  return unique(variants);
}

function expandPropertyValues(...values: Array<string | undefined>): string[] {
  return values.flatMap((value) => expandPropertyValue(value));
}

function expandPropertyValue(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

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

function cueValue(text: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(text);
  const value = firstString(match?.[1], match?.[2], match?.[3]);
  return value?.replace(/[,.]$/g, '');
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

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
