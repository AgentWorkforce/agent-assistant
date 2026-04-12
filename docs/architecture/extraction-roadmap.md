# Extraction Roadmap

Date: 2026-04-11

## Goal

Extract a stable OSS assistant SDK without freezing product development in Sage, MSD, NightCTO, or future repos.

The roadmap favors:

- contracts before concrete implementations
- package boundaries before code moves
- adapters before rewrites
- one reusable slice at a time

## Phase 0: Docs-first foundation

Deliverables:

- root README that defines the repo and layer model
- package boundary map
- OSS vs cloud split guidance
- consumer adoption docs
- package README placeholders

Exit criteria:

- every consumer can understand what this repo will own
- every product team can identify what should stay in its own repo

## Phase 1: Establish package shells and type contracts

Target packages:

- `@agent-assistant/core`
- `@agent-assistant/sessions`
- `@agent-assistant/surfaces`

Reason:

- consumers need a stable assistant construction and session model before higher-level memory or proactive logic can converge cleanly

Deliverables:

- package manifests and empty source shells
- assistant definition and runtime contracts
- assistant session contracts
- assistant-facing surface contracts

Non-goals:

- backend adapters
- product migrations
- cloud deployment code

## Phase 2: Extract shared memory contracts

Primary source signals:

- Sage memory patterns
- NightCTO per-client continuity requirements

Deliverables:

- `MemoryStore` contract
- memory scopes and retrieval APIs
- promotion and compaction extension points
- placeholder adapter interfaces

Adoption rule:

- move shared memory semantics here
- leave product-specific tagging and prompt composition in product repos

## Phase 3: Extract proactive engine contracts

Primary source signals:

- Sage follow-ups and stale-thread handling
- NightCTO proactive monitoring and digests

Deliverables:

- `ProactiveEngine`
- watcher and reminder contracts
- scheduler binding interfaces over Relay substrate
- evidence model for proactive decisions

Adoption rule:

- the engine and policies move here
- each product still owns its own domain-specific watcher definitions until generalized

## Phase 4: Extract coordination and policy

Primary source signals:

- NightCTO specialist orchestration
- MSD orchestration requirements

Deliverables:

- coordinator and specialist registry contracts
- delegation and synthesis interfaces
- approval modes and audit hooks

Adoption rule:

- keep general orchestration semantics here
- keep product-specific specialist lineups and business escalation policy outside

## Phase 5: Publish examples and reference integrations

Deliverables:

- example assistant definitions
- example product integration docs
- migration examples from product repos to SDK packages

Example targets:

- Sage-style memory-heavy assistant
- MSD-style review-oriented assistant
- NightCTO-style specialist-based assistant

## Migration Strategy

Use wrappers first.

Preferred migration order:

1. define shared interfaces in this repo
2. adapt product code to those interfaces without large rewrites
3. move generalized code only after multiple products depend on the shared contract
4. remove duplicate implementations later

This reduces churn and keeps products shipping while the SDK stabilizes.

## What Not To Do

Avoid:

- moving product logic into the SDK just because it exists first in one product
- rebuilding Relay foundation primitives here
- tying package interfaces to one backend or one surface too early
- introducing cloud-only assumptions into OSS package contracts

## Success Criteria

This roadmap succeeds when:

- products can adopt packages incrementally
- product repos keep their domain logic and velocity
- the SDK remains useful without any hosted cloud dependency
- a future cloud layer can build on the OSS contracts without forking them
