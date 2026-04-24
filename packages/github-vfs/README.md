# @agent-assistant/github-vfs

Reusable GitHub helpers for assistant products backed by RelayFile-style VFS data.

This package owns the `/github/repos/{owner}/{repo}/pulls/{number}/metadata.json` convention and the deterministic helpers that read open pull request summaries from a `VfsProvider`.

It does not format Slack, Discord, or CLI replies. Products should use the typed summaries and cite the returned `sourcePath` values in user-visible answers.

```ts
import {
  detectOpenPrListIntent,
  listOpenPullRequestsFromVfs,
} from '@agent-assistant/github-vfs';

const repo = detectOpenPrListIntent('list open PRs in AgentWorkforce/cloud');

if (repo) {
  const pulls = await listOpenPullRequestsFromVfs(provider, repo);
  for (const pull of pulls) {
    console.log(`#${pull.number} ${pull.title}`, pull.sourcePath);
  }
}
```

Use `createGithubVfsToolRegistry` when you want to expose the `workspace_github_list_open_prs` harness tool alongside other workspace tools.
