---
name: using-relayfile-vfs
description: Use when the assistant has a workspace VFS (via @agent-assistant/harness workspace_* tools) backed by RelayFile. Covers path conventions per provider and the cite-your-source discipline. Provider-specific rows are populated at runtime from /_conventions/*.json written by cataloging agents; hand-written rows below are the fallback.
---

## When to use

The assistant has `workspace_list`, `workspace_read`, `workspace_read_json`, and
`workspace_search` tools available, backed by a RelayFile VFS that's been synced
by cataloging agents. Prefer these generic tools to any provider-specific
API when the answer is a lookup from synced state.

## Rules

- Every factual claim about workspace data must cite the VFS path or
  `sourcePath` returned by a tool. No path, no claim.
- Empty result is an empty result. If `workspace_list` or
  `workspace_read_json` returns nothing for path X, don't substitute
  prior knowledge — say X returned no data and stop.
- Tool errors surface verbatim (with tool name), not rephrased into a
  plausible answer.

## Path conventions

### GitHub (`/github/...`)

| Shape | Example | Contents |
|---|---|---|
| `/github/repos/{owner}/{repo}/metadata.json` | repo | repo metadata |
| `/github/repos/{owner}/{repo}/pulls/{n}/metadata.json` | PR | PR metadata incl. `state: open\|closed` |
| `/github/repos/{owner}/{repo}/issues/{n}/metadata.json` | issue | issue metadata |
| `/github/repos/{owner}/{repo}/commits/{sha}/metadata.json` | commit | commit metadata |

Worked example — list open PRs in `{owner}/{repo}`:
1. `workspace_list('/github/repos/{owner}/{repo}/pulls', depth=2)`
2. For each returned `metadata.json` path, `workspace_read_json(path)`
3. Filter where `json.state === 'open'`
4. Sort by `json.updated_at` descending

Cite each `metadata.json` path in the reply.

### Other providers

Provider conventions published to `/_conventions/<provider>.json` by their
cataloging agents. Assistant runtimes should list `/_conventions` at turn
start and fold those rows into this skill. Stubs:

- `slack`: TBD (populated by `cataloging-agent-slack`)
- `linear`: TBD (populated by `cataloging-agent-linear`)
- `notion`: TBD (populated by `cataloging-agent-notion`)
- `teams`: TBD (populated by `cataloging-agent-teams`)
- `gitlab`: TBD (populated by `cataloging-agent-gitlab`)
