# @agent-assistant/vfs

Provider-neutral virtual filesystem contracts and a Bash-oriented CLI runner for assistant products.

The package does not know about RelayFile, Linear, Slack, GitHub, or any product-specific path grammar. Products adapt their own stores to `VfsProvider`; the shared package owns command parsing, output conventions, and the small contract that lets an assistant inspect a filesystem-like knowledge surface from Bash.

```typescript
import { runVfsCli } from '@agent-assistant/vfs';
import type { VfsProvider } from '@agent-assistant/vfs';

const provider: VfsProvider = {
  list: async (path) => [{ path: `${path}/notes.md`, type: 'file' }],
  read: async (path) => ({ path, content: 'hello' }),
  search: async (query) => [{ path: '/notes.md', type: 'file', snippet: query }],
};

process.exitCode = await runVfsCli({
  name: 'product-vfs',
  provider,
  argv: process.argv.slice(2),
});
```

## Commands

```bash
product-vfs list /linear --depth 2 --limit 50
product-vfs tree /linear --depth 3
product-vfs read /linear/issues/ABC-123/issue.json
product-vfs search "roadmap Q2" --provider linear --limit 10
product-vfs stat /linear/issues/ABC-123/issue.json
```

Add `--json` to `list`, `tree`, `read`, `search`, or `stat` for machine-readable output.
