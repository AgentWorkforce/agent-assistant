# Agent Assistant SDK Rename Application Review Verdict

Date: 2026-04-12

## Verdict

**FAIL**

The rename application is not yet consistent enough to pass. Package manifests and most public prose were updated, but active workflow definitions still retain old-name identifiers, and the public docs surface now contains broken links introduced by the rename. The application report also overstates completion, so the repo cannot currently be treated as a cleanly finished rename pass.

## Findings

### 1. Active workflow IDs still use the retired `relay-assistant` name

This is the most important failure because the boundary explicitly requires workflow `.ts` files to rename old-name string literals and workflow channel/name surfaces, and the application report claims Phase 4 completed successfully.

- [workflows/audit-repo-for-robustness.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/workflows/audit-repo-for-robustness.ts:5) still uses `workflow('relay-assistant-audit-repo-for-robustness')`.
- [workflows/implement-publish-infrastructure.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/workflows/implement-publish-infrastructure.ts:5) still uses `workflow('relay-assistant-implement-publish-infrastructure')`.
- [workflows/implement-v1-policy.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/workflows/implement-v1-policy.ts:5) still uses `workflow('relay-assistant-implement-v1-policy')`.
- [workflows/specify-publish-infrastructure.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/workflows/specify-publish-infrastructure.ts:5) still uses `workflow('relay-assistant-specify-publish-infrastructure')`.
- [workflows/specify-v1-consumer-adoption-paths.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/workflows/specify-v1-consumer-adoption-paths.ts:5) still uses `workflow('relay-assistant-specify-v1-consumer-adoption-paths')`.
- [workflows/tighten-repo-organization.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/workflows/tighten-repo-organization.ts:5) still uses `workflow('relay-assistant-tighten-repo-organization')`.
- [workflows/rename-to-agent-assistant-sdk.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/workflows/rename-to-agent-assistant-sdk.ts:5) still uses `workflow('rename-relay-assistant-to-agent-assistant-sdk')`.

There are also residual old-scope strings in active workflow instructions:

- [workflows/implement-v1-policy.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/workflows/implement-v1-policy.ts:97)
- [workflows/implement-v1-proactive.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/workflows/implement-v1-proactive.ts:99)

These are not historical-doc exceptions. They are live workflow definitions and should have been updated.

### 2. Public README and docs index link to a consumer doc that does not exist

The README is substantially improved for open-source readers, but the rename introduced broken links:

- [README.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/README.md:116) links to `docs/consumer/how-products-should-adopt-agent-assistant-sdk.md`.
- [docs/index.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/index.md:36) and [docs/index.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/index.md:43) similarly point at renamed targets.
- [docs/consumer/v1-product-adoption-matrix.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/consumer/v1-product-adoption-matrix.md:272) also points at the renamed path.

But the actual file on disk is still [docs/consumer/how-products-should-adopt-agent-assistant-sdk.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/consumer/how-products-should-adopt-agent-assistant-sdk.md:1), which matches the application boundary’s explicit note that the filename would stay unchanged for now.

That leaves the public landing path understandable in prose, but not dependable in navigation.

### 3. The application report is inaccurate about completion

The report claims a complete success state that is not supported by the repo state:

- [docs/architecture/agent-assistant-sdk-rename-application-report.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/agent-assistant-sdk-rename-application-report.md:11) says, "All six phases completed successfully."
- [docs/architecture/agent-assistant-sdk-rename-application-report.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/agent-assistant-sdk-rename-application-report.md:124) claims `workflows/*.ts` were updated across 39 files.

That is inconsistent with the remaining old workflow IDs and broken renamed links above. The report should be corrected before this work is treated as done.

## Assessment Against Requested Questions

### 1. Is the rename application consistent?

No. The package-manifest rename is largely consistent, and `.github/workflows/publish.yml` was updated correctly for published package names, but active workflow definitions and consumer-doc links are still inconsistent with the target rename.

### 2. Are stale old-name references removed except where intentionally historical?

No. Old-name references remain in active `workflows/*.ts` files, which the boundary explicitly treats as rename-in-scope rather than historical. Those are stale operational references, not intentional historical records.

### 3. Is the public README now understandable to open-source readers?

Mostly yes in tone and structure. It is much clearer than the previous internal-facing README, uses the new public product name, and explains the package map and architecture in OSS terms. However, it is not fully ready because it links readers to a non-existent adoption guide path, which undermines trust in the landing experience.

## Required Follow-Ups

1. Rename the remaining active workflow IDs and residual old-scope strings in `workflows/*.ts`.
2. Fix README/docs links to point to the existing consumer-adoption file, or rename that file in the same change.
3. Update the application report so it reflects the actual completion state after the above fixes land.

## Review Summary

The rename pass made real progress: package manifests, publish workflow package names, and the public README framing are substantially improved. But the pass is not internally consistent yet, stale old-name references remain on active operational surfaces, and the public docs navigation is broken. The rename application should not be marked complete until those follow-ups are resolved.
