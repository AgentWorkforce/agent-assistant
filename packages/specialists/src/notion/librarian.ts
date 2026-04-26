import type { VfsEntry } from '@agent-assistant/vfs';

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
import type {
  NotionEntityType,
  NotionEnumerationCapability,
  NotionEnumerationParams,
} from './types.js';

export type NotionEnumerationType = NotionEntityType;

const NOTION_ENUMERATION_CAPABILITY: NotionEnumerationCapability = 'notion.enumerate';
type EnumerationStatus = LibrarianStatus;
const NOTION_FILTER_KEYS = ['type', 'database', 'title', 'tag', 'author'] as const;
const NOTION_ENTITY_TYPES = new Set<string>(['page', 'database', 'block', 'comment']);

type NotionLibrarianVfs = LibrarianVfs;
type NotionLibrarianFallbackRequest = LibrarianFallbackRequest<NotionEnumerationType>;
type NotionLibrarianApiFallback = LibrarianApiFallback<NotionEnumerationType>;

export interface NotionLibrarianOptions {
  vfs: NotionLibrarianVfs;
  apiFallback?: NotionLibrarianApiFallback;
}

export interface NotionEnumerationEvidenceContent
  extends Partial<
    Record<
      | 'provider'
      | 'revision'
      | 'updatedAt'
      | 'createdAt'
      | 'url'
      | 'identifier'
      | 'databaseId'
      | 'snippet',
      string
    >
  > {
  type: NotionEnumerationType | 'notion';
  path: string;
  title: string;
  database: string;
  tag: string[];
  author: string;
  properties: Record<string, string>;
}

export interface NotionEnumerationEvidence {
  id: string;
  kind: 'enumeration_hit';
  content: NotionEnumerationEvidenceContent;
}

export interface NotionLibrarianFindings
  extends Omit<GenericLibrarianFindings, 'capability' | 'status' | 'evidence'> {
  capability: NotionEnumerationCapability;
  status: EnumerationStatus;
  evidence: NotionEnumerationEvidence[];
}

export interface NotionLibrarianSpecialist
  extends Omit<
    GenericLibrarianSpecialist<NotionEnumerationType>,
    'name' | 'capabilities' | 'handler'
  > {
  name: 'notion-librarian';
  capabilities: NotionEnumerationCapability[];
  handler: {
    execute(instruction: string, context?: unknown): Promise<NotionLibrarianFindings>;
  };
}

const COLLECTION_ROOT_BY_TYPE: Record<NotionEnumerationType, string> = {
  page: '/notion/pages/',
  database: '/notion/databases/',
  block: '/notion/blocks/',
  comment: '/notion/comments/',
};

const notionLibrarianAdapter: LibrarianAdapter<NotionEnumerationType> = {
  capability: NOTION_ENUMERATION_CAPABILITY,
  entityTypes: ['page', 'database', 'block', 'comment'],
  filterKeys: ['type', 'database', 'title', 'tag', 'author'],
  searchProvider: 'notion',
  listRoots(types) {
    return types.map((type) => COLLECTION_ROOT_BY_TYPE[type]);
  },
  inferFilters: inferEnumerationFilters,
  valuesForFilter,
  inferEntityType,
  toEvidence,
};

export function createNotionLibrarian({
  vfs,
  apiFallback,
}: NotionLibrarianOptions): NotionLibrarianSpecialist {
  const options = {
    vfs,
    name: 'notion-librarian',
    description: 'Enumerates Notion pages, databases, blocks, and comments from VFS-backed metadata.',
  };
  const engine = createLibrarian(notionLibrarianAdapter, apiFallback ? { ...options, apiFallback } : options);
  return engine as unknown as NotionLibrarianSpecialist;
}

export async function enumerateNotion(
  params: NotionEnumerationParams,
  options: NotionLibrarianOptions,
): Promise<NotionLibrarianFindings> {
  return createNotionLibrarian(options).handler.execute(buildEnumerationInstruction(params));
}

function buildEnumerationInstruction(params: NotionEnumerationParams): string {
  const parts = params.query?.trim() ? [params.query.trim()] : [];
  const filters = params.filters ?? {};

  for (const key of NOTION_FILTER_KEYS) {
    for (const value of filters[key] ?? []) {
      // The shared parseQuery splits the instruction on /\s+/, so any
      // whitespace inside a `key:value` token would split the value across
      // tokens and corrupt the filter (e.g. `database:Product Roadmap`
      // would parse as filter `database:Product` plus stray text `Roadmap`).
      // For Notion, multi-word filter values (database names, page titles)
      // are normal — append them as bare text so `inferEnumerationFilters`
      // can pattern-match them downstream instead of getting them silently
      // mangled by the parser.
      if (/\s/.test(value)) {
        parts.push(value);
      } else {
        parts.push(`${key}:${value}`);
      }
    }
  }

  return parts.join(' ').trim();
}

function inferEnumerationFilters(text: string, parsedFilters: Record<string, string[]>): Record<string, string[]> {
  const filters = cloneFilters(parsedFilters);
  inferExplicitFilters(text, filters);
  const normalizedText = ` ${text.toLowerCase().replace(/[-_]+/g, ' ')} `;

  if (!filters.type?.length) {
    if (/\b(page|pages)\b/.test(normalizedText)) filters.type = ['page'];
    else if (/\b(database|databases)\b/.test(normalizedText)) filters.type = ['database'];
    else if (/\b(block|blocks)\b/.test(normalizedText)) filters.type = ['block'];
    else if (/\b(comment|comments)\b/.test(normalizedText)) filters.type = ['comment'];
  }

  if (!filters.database?.length) {
    const database = cueValue(text, /\bdatabase\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
    if (database) filters.database = [database];
  }

  if (!filters.author?.length) {
    const author = cueValue(text, /\b(?:author|by)\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
    if (author) filters.author = [author];
  }

  if (!filters.tag?.length) {
    const tag = cueValue(text, /\btag(?:ged)?\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
    if (tag) filters.tag = [tag];
  }

  if (!filters.title?.length) {
    const title = cueValue(text, /\btitle\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
    if (title) filters.title = [title];
  }

  return filters;
}

function inferExplicitFilters(text: string, filters: Record<string, string[]>): void {
  for (const token of text.trim().split(/\s+/)) {
    if (!token) continue;

    const separatorIndex = token.indexOf(':');
    if (separatorIndex <= 0 || separatorIndex === token.length - 1) continue;

    const key = token.slice(0, separatorIndex).toLowerCase();
    if (!NOTION_FILTER_KEYS.includes(key as (typeof NOTION_FILTER_KEYS)[number])) continue;

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
    const normalizedType = normalizeEntityType(trimmed);
    return NOTION_ENTITY_TYPES.has(normalizedType) ? normalizedType : undefined;
  }

  return trimmed;
}

function normalizeEntityType(value: string): string {
  const normalized = value.toLowerCase().replace(/[-_\s]+/g, '');
  if (normalized === 'page' || normalized === 'pages') return 'page';
  if (normalized === 'database' || normalized === 'databases') return 'database';
  if (normalized === 'block' || normalized === 'blocks') return 'block';
  if (normalized === 'comment' || normalized === 'comments') return 'comment';
  return normalized;
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

  if (key === 'type') {
    const type = inferEntityType(entry);
    return [properties.type, type === 'unknown' ? undefined : type].filter(isString);
  }
  if (key === 'database') {
    return expandPropertyValues(
      properties.database,
      properties.databaseId,
      properties.databaseTitle,
      properties.parentDatabase,
      properties.parentId,
    );
  }
  if (key === 'title') {
    return expandPropertyValues(properties.title, properties.name, entry.title);
  }
  if (key === 'tag') {
    return expandPropertyValues(properties.tag, properties.tags);
  }
  if (key === 'author') {
    return expandPropertyValues(
      properties.author,
      properties.createdBy,
      properties.lastEditedBy,
      properties.lastEditedByName,
    );
  }

  return [];
}

function inferEntityType(entry: VfsEntry): NotionEnumerationType | 'unknown' {
  const propertyType = firstString(
    entry.properties?.type,
    entry.properties?.objectType,
    entry.properties?.entityType,
  )
    .toLowerCase()
    .replace(/[-_\s]+/g, '');

  if (propertyType === 'page' || propertyType === 'notionpage') return 'page';
  if (propertyType === 'database' || propertyType === 'notiondatabase') return 'database';
  if (propertyType === 'block' || propertyType === 'notionblock') return 'block';
  if (propertyType === 'comment' || propertyType === 'notioncomment') return 'comment';
  return collectionItemTypeFromPath(entry.path) ?? 'unknown';
}

function toEvidence(
  entry: VfsEntry,
  type: NotionEnumerationType | 'unknown',
): NotionEnumerationEvidence {
  const properties = entry.properties ?? {};
  const content: NotionEnumerationEvidenceContent = {
    type: type === 'unknown' ? 'notion' : type,
    path: entry.path,
    title: firstString(entry.title, properties.title, properties.name, idFromPath(entry.path), entry.path),
    database: firstString(
      properties.database,
      properties.databaseTitle,
      properties.parentDatabase,
      properties.parentId,
    ),
    tag: unique(expandPropertyValues(properties.tag, properties.tags)),
    author: firstString(
      properties.author,
      properties.createdBy,
      properties.lastEditedBy,
      properties.lastEditedByName,
    ),
    properties,
  };
  const id = firstString(
    properties.id,
    properties.pageId,
    properties.databaseId,
    properties.blockId,
    properties.commentId,
    idFromPath(entry.path),
    entry.path,
  );
  const identifier = firstString(properties.identifier, properties.slug, idFromPath(entry.path));
  const databaseId = firstString(properties.databaseId, properties.parentId);
  const snippet = snippetFromEntry(entry);

  for (const key of ['provider', 'revision', 'updatedAt'] as const) {
    const value = entry[key];
    if (value) content[key] = value;
  }
  for (const key of ['createdAt', 'url'] as const) {
    const value = properties[key];
    if (value) content[key] = value;
  }
  if (identifier) content.identifier = identifier;
  if (databaseId) content.databaseId = databaseId;
  if (snippet) content.snippet = snippet;

  return { id, kind: 'enumeration_hit', content };
}

function collectionItemTypeFromPath(path: string): NotionEnumerationType | undefined {
  const match = /\/notion\/(pages|databases|blocks|comments)\/[^/]+(?:\.json)?$/i.exec(path);
  if (match?.[1] === 'pages') return 'page';
  if (match?.[1] === 'databases') return 'database';
  if (match?.[1] === 'blocks') return 'block';
  if (match?.[1] === 'comments') return 'comment';
  return undefined;
}

function idFromPath(path: string): string | undefined {
  const leaf = path.split('/').filter(Boolean).at(-1);
  if (!leaf) return undefined;
  return decodeSegment(leaf.replace(/\.json$/i, ''));
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
