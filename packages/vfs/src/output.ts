import type { VfsEntry, VfsReadResult, VfsSearchResult } from './types.js';

export interface TruncatedReadResult extends VfsReadResult {
  truncated: boolean;
}

export function normalizeVfsPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }

  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`;
}

export function dirname(filePath: string): string {
  const normalized = normalizeVfsPath(filePath);
  if (normalized === '/') {
    return '/';
  }

  const index = normalized.lastIndexOf('/');
  return index <= 0 ? '/' : normalized.slice(0, index);
}

export function basename(filePath: string): string {
  const normalized = normalizeVfsPath(filePath);
  if (normalized === '/') {
    return '/';
  }

  const index = normalized.lastIndexOf('/');
  return decodePathSegment(normalized.slice(index + 1));
}

export function formatEntry(entry: VfsEntry): string {
  const details = [
    entry.type,
    entry.provider,
    entry.title,
    entry.revision ? `rev:${entry.revision}` : undefined,
  ].filter((part): part is string => Boolean(part));

  return details.length > 0 ? `${entry.path}\t${details.join('\t')}` : entry.path;
}

export function formatEntries(entries: VfsEntry[]): string {
  if (entries.length === 0) {
    return 'No entries.';
  }

  return entries.map((entry) => formatEntry(entry)).join('\n');
}

export function formatSearchResults(results: VfsSearchResult[]): string {
  if (results.length === 0) {
    return 'No results.';
  }

  return results
    .map((result, index) => {
      const lines = [
        `${index + 1}. ${result.title ?? basename(result.path)}`,
        `   path: ${result.path}`,
      ];

      if (result.provider) {
        lines.push(`   provider: ${result.provider}`);
      }
      if (result.revision) {
        lines.push(`   revision: ${result.revision}`);
      }
      if (result.snippet) {
        lines.push(`   snippet: ${collapseWhitespace(result.snippet)}`);
      }

      return lines.join('\n');
    })
    .join('\n\n');
}

export function truncateReadResult(
  result: VfsReadResult,
  maxContentChars: number,
): TruncatedReadResult {
  if (maxContentChars < 0 || result.content.length <= maxContentChars) {
    return { ...result, truncated: false };
  }

  return {
    ...result,
    content: result.content.slice(0, maxContentChars),
    truncated: true,
  };
}

export function formatReadResult(result: TruncatedReadResult): string {
  const lines = [`Path: ${result.path}`];

  if (result.contentType) {
    lines.push(`Content-Type: ${result.contentType}`);
  }
  if (result.provider) {
    lines.push(`Provider: ${result.provider}`);
  }
  if (result.revision) {
    lines.push(`Revision: ${result.revision}`);
  }

  lines.push('', 'Content:', result.content);

  if (result.truncated) {
    lines.push('', `[truncated to ${result.content.length} chars]`);
  }

  return lines.join('\n');
}

export function formatTree(rootPath: string, entries: VfsEntry[]): string {
  const root = normalizeVfsPath(rootPath);
  const sorted = [...entries].sort((left, right) => left.path.localeCompare(right.path));

  if (sorted.length === 0) {
    return `${root}\n(no entries)`;
  }

  const lines = [root];
  for (const entry of sorted) {
    if (entry.path === root) {
      continue;
    }

    const relative = relativeToRoot(root, entry.path);
    const segments = relative.split('/').filter(Boolean);
    const depth = Math.max(0, segments.length - 1);
    const label = entry.title ?? decodePathSegment(segments[segments.length - 1] ?? entry.path);
    lines.push(`${'  '.repeat(depth)}- ${label} [${entry.type}] ${entry.path}`);
  }

  return lines.join('\n');
}

export function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function relativeToRoot(rootPath: string, entryPath: string): string {
  const root = normalizeVfsPath(rootPath);
  const entry = normalizeVfsPath(entryPath);
  if (root === '/') {
    return entry.slice(1);
  }
  if (entry === root) {
    return '';
  }
  if (entry.startsWith(`${root}/`)) {
    return entry.slice(root.length + 1);
  }
  return entry.slice(1);
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
