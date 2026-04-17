# Librarian Adapters

## Engines

`createLibrarian(adapter, options)` gives you query parsing, natural-language filter inference, VFS list/search, optional API fallback, a non-throwing error envelope in `metadata.errors`, dedupe by `entry.path`, adapter-defined filtering, sort by `updatedAt` descending then `path`, evidence mapping, and a concise summary.

`createInvestigator(adapter, deps)` gives you JSON/plain-text target parsing, raw/metadata/diff VFS reads, optional API fallback, failed findings with `gaps`, a consistent specialist result envelope, optional durable evidence writes, source metadata, action counts, duration, confidence, and summary hooks.

## LibrarianAdapter

| Field | Description |
| --- | --- |
| `capability` | Public capability string, usually `<provider>.enumerate`. |
| `entityTypes` | Supported typed collections, such as `issue`, `project`, or `pr`. |
| `listRoots(types, filters)` | VFS roots to list for requested types and filters. |
| `inferFilters(text, filters)` | Converts domain language cues into normalized filters. |
| `filterKeys` | Filter names the engine should enforce. |
| `valuesForFilter(entry, key)` | Comparable values extracted from one VFS entry. |
| `inferEntityType(entry)` | Entity type inferred from properties or path shape. |
| `toEvidence(entry, type)` | Domain evidence shape returned to callers. |
| `searchProvider` | Optional VFS search provider hint, such as `github`. |

## InvestigatorAdapter

| Field | Description |
| --- | --- |
| `capability` | Public capability string for the investigation. |
| `specialistName` | Stable coordination specialist name. |
| `specialistVersion` | Version emitted in result metadata. |
| `paths(target)` | Candidate VFS metadata/raw paths and optional diff path. |
| `parse(raw)` | Converts VFS/API text into a typed entity, or returns `null`. |
| `toEvidence(entity, target)` | Converts the typed entity into findings. |
| `apiFallback(target)` | Optional direct API read when VFS misses. |
| `durableEvidenceThresholdBytes` | Optional large-evidence persistence threshold. |

## Next Integration Skeleton

Import path helpers from `@relayfile/adapter-<name>/path-mapper`; for Notion, use `@relayfile/adapter-notion/path-mapper`.

```ts
import { notionDatabasePath, notionPagePath } from '@relayfile/adapter-notion/path-mapper';
import {
  createLibrarian,
  type LibrarianAdapter,
  type LibrarianApiFallback,
  type LibrarianVfs,
} from '../shared/librarian-engine.js';

type NotionEntityType = 'page' | 'database';
const NOTION_CAPABILITY = 'notion.enumerate';

export interface NotionLibrarianOptions {
  vfs: LibrarianVfs;
  apiFallback?: LibrarianApiFallback<NotionEntityType>;
}

const ROOT_BY_TYPE: Record<NotionEntityType, string> = {
  page: collectionRootFromPath(notionPagePath('__root__')),
  database: collectionRootFromPath(notionDatabasePath('__root__')),
};

const notionLibrarianAdapter: LibrarianAdapter<NotionEntityType> = {
  capability: NOTION_CAPABILITY,
  entityTypes: ['page', 'database'],
  filterKeys: ['workspace', 'parent', 'tag', 'type'],
  searchProvider: 'notion',
  listRoots(types) {
    return types.map((type) => ROOT_BY_TYPE[type]);
  },
  inferFilters(text, parsedFilters) {
    const filters = cloneFilters(parsedFilters);
    // TODO: infer type/tag/workspace cues from text.
    return filters;
  },
  valuesForFilter(entry, key) {
    const properties = entry.properties ?? {};
    if (key === 'type') return [properties.type].filter(isString);
    if (key === 'workspace') return [properties.workspace, properties.workspaceId].filter(isString);
    if (key === 'parent') return [properties.parent, properties.parentId].filter(isString);
    if (key === 'tag') return expandPropertyValues(properties.tag, properties.tags);
    return [];
  },
  inferEntityType(entry) {
    // TODO: prefer properties.type, then path collection.
    return 'unknown';
  },
  toEvidence(entry, type) {
    const properties = entry.properties ?? {};
    return {
      id: properties.id ?? entry.path,
      kind: 'enumeration_hit',
      content: { type, path: entry.path, title: entry.title ?? properties.title ?? entry.path, properties },
    };
  },
};

export function createNotionLibrarian(input: NotionLibrarianOptions) {
  const options = { vfs: input.vfs, name: 'notion-librarian', description: 'Enumerates Notion from VFS metadata.' };
  return createLibrarian(notionLibrarianAdapter, input.apiFallback ? { ...options, apiFallback: input.apiFallback } : options);
}
```

Fill in domain types, evidence interfaces, typed specialist return shape, `inferEntityType`, `toEvidence`, and small helpers such as `collectionRootFromPath`, `cloneFilters`, `expandPropertyValues`, and `isString`.

## Testing Recipe

- Put focused tests beside the adapter, e.g. `src/notion/librarian.test.ts`.
- Define an inline `InMemoryVfsProvider implements VfsProvider`; back it with literal `VfsEntry[]` or a file map.
- Implement `list`, `read`, and `search` only as much as the case needs.
- Do not mock real modules, path mappers, or shared engines.
- Import the public factory, execute it, and assert evidence ids, typed content, filters, empty failures, fallback behavior, and fixed-`updatedAt` sort order.
- For investigators, record `vfs.reads` and assert expected metadata/diff paths.

## References

- `src/github/librarian.ts`: repo-scoped roots via `githubRepoPrefix`, PR/issue inference, label expansion.
- `src/linear/librarian.ts`: path-mapper collection roots, explicit filters, state/team/assignee matching.
- `src/github/librarian.test.ts` and `src/linear/librarian.test.ts`: inline fake VFS providers with no real module mocks.
