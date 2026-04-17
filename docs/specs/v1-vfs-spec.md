# V1 VFS Spec

Status: IMPLEMENTATION_READY
Package: `@agent-assistant/vfs`

## Purpose

`@agent-assistant/vfs` defines a provider-neutral virtual filesystem contract for assistant products that want a filesystem-shaped read surface without writing custom per-integration Bash tools.

The package owns:
- the small shared provider contract
- path normalization rules
- text and JSON output conventions
- a reusable CLI runner for filesystem-style inspection commands

The package does not own:
- product-specific path grammars
- provider-specific API clients
- provider auth
- RelayFile schema ownership
- specialist behavior or synthesis logic

## Goals

1. Give products one reusable primitive for list/tree/read/search/stat style inspection.
2. Keep the provider contract small enough to adapt many backends.
3. Make the CLI Bash-friendly for agent workflows.
4. Keep output deterministic and easy to parse.
5. Avoid baking provider-specific assumptions into the shared package.

## Provider Contract

```ts
export interface VfsProvider {
  list(path: string, options?: VfsListOptions): Promise<VfsEntry[]>;
  read(path: string): Promise<VfsReadResult | null>;
  search(query: string, options?: VfsSearchOptions): Promise<VfsSearchResult[]>;
  stat?(path: string): Promise<VfsEntry | null>;
}
```

### Required methods
- `list()` returns entries rooted at a normalized path
- `read()` returns file-like content or `null`
- `search()` returns matching entry-like results

### Optional method
- `stat()` returns one entry for an exact path lookup
- when `stat()` is absent, the CLI may fall back to listing the parent directory and matching exact normalized paths

## Path Rules

All CLI command paths must pass through shared normalization.

Normalization rules:
- empty input normalizes to `/`
- output always starts with `/`
- leading and trailing slashes are trimmed before re-prefixing
- internal repeated slashes are collapsed
- normalized paths are used for exact comparisons, parent lookup, and rendered output

Examples:
- `` -> `/`
- `/` -> `/`
- `linear/issues` -> `/linear/issues`
- `/linear//issues/ABC-1/` -> `/linear/issues/ABC-1`

## Commands

The shared CLI runner exposes five commands:

### `list`
```bash
<name> list [path] [--depth N] [--limit N] [--json]
```

Behavior:
- defaults path to `/`
- calls `provider.list(path, { depth, limit })`
- prints deterministic table-like text or JSON

### `tree`
```bash
<name> tree [path] [--depth N] [--limit N] [--json]
```

Behavior:
- defaults path to `/`
- uses `list()` output and renders a deterministic tree view

### `read`
```bash
<name> read <path> [--max-chars N] [--json]
```

Behavior:
- requires exactly one path
- returns exit code `1` with `Not found:` on miss
- may truncate content to configured maximum characters
- indicates truncation in text mode

### `search`
```bash
<name> search <query> [--provider NAME] [--limit N] [--json]
```

Behavior:
- requires a query
- passes provider filter and limit through to `search()`
- returns ordered result blocks in text mode or JSON

### `stat`
```bash
<name> stat <path> [--limit N] [--json]
```

Behavior:
- requires exactly one path
- if `provider.stat()` exists, it should be used first
- otherwise, fallback exact-match lookup may use `list(dirname(path), { depth: 1, limit })`
- returns exit code `1` with `Not found:` on miss

## Flag Semantics

Supported value-taking flags:
- `--depth`
- `--limit`
- `--provider`
- `--max-chars`

If a required value is missing for one of these flags, the CLI must return a usage error instead of silently falling back to defaults.

Unknown flags must return a usage error.

## Output Semantics

### Text mode
- intended for Bash-first usage
- deterministic, line-oriented output
- empty list/search results render explicit `No entries.` / `No results.` messages
- `read` renders metadata header lines followed by content

### JSON mode
- enabled with `--json`
- returns pretty-printed deterministic JSON with trailing newline
- output shape mirrors provider contract objects

## Exit Codes

- `0` success
- `1` runtime miss or provider failure (for example `Not found`)
- `2` usage error

## Current Scope Boundary

This package is intentionally small.

It does not yet define:
- write/update/delete operations
- globbing
- pagination cursors
- auth negotiation
- provider registration/discovery protocols
- streaming reads

Those can be added later only if multiple products prove the need.

VFS_SPEC_IMPLEMENTATION_READY
