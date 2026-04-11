Completed the connectivity docs spike and wrote all required files to disk.

Artifacts produced:
- `packages/connectivity/README.md`
- `docs/architecture/connectivity-package-spec.md`
- `docs/consumer/connectivity-adoption-guide.md`
- `docs/research/connectivity-patterns.md`
- updated `README.md`
- updated `docs/index.md`

What the docs now cover:
- focused coordination messages vs generic chatter
- conceptual message classes and signal classes
- efficiency principles: low latency, selective routing, bounded verbosity, convergence over chatter
- workforce-informed routing realities: `cheap`, `fast`, `deep`, with a fixed quality bar across tiers
- concrete product usage for Sage, MSD, and NightCTO
- OSS-first boundaries with cloud-specific behavior deferred behind adapters
- a staged path from docs to specs to workflows to code

Verification:
- `packages/connectivity/README.md` ends with `CONNECTIVITY_DOCS_READY`
- connectivity is now linked from both repo-level discovery docs

Notes:
- the touched paths show as untracked in the current git state, but the files are present on disk with the requested content.
