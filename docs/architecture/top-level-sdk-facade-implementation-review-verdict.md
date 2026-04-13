# Top-Level SDK Facade Implementation Review Verdict

Date: 2026-04-13
Verdict: PASS_WITH_FOLLOWUPS

## Findings

### 1. Stale architecture guidance now contradicts the new public facade path

`docs/architecture/package-boundary-map.md` was updated to introduce `@agent-assistant/sdk` as the facade (`docs/architecture/package-boundary-map.md:123-132`), but the same document still says `@agent-assistant/traits` is "planned — v1.2" and that `AssistantDefinition` does not yet have a `traits` field (`docs/architecture/package-boundary-map.md:149-165`). That is materially out of sync with the implemented facade, the README quick start, the hello-world example, and the adoption guide, all of which treat traits as part of the stable entrypoint today.

Impact: a reader using the architecture map as a source of truth can get the wrong impression about what the facade actually exposes and what the current baseline supports.

Follow-up: reconcile the stale historical sections in `package-boundary-map.md` with the current package reality or add an explicit archival note so it is not read as active guidance.

### 2. The examples corpus is facade-first, but not facade-only

The happy-path example is aligned: `packages/examples/src/00-hello-world.ts:3-18` uses only `@agent-assistant/sdk`, matching the README quick start (`README.md:16-48`) and the adoption guide's "one install / one import" framing (`docs/consumer/top-level-sdk-adoption-guide.md:23-35`).

However, several reference examples still import advanced types directly from constituent packages:

- `packages/examples/src/01-minimal-assistant.ts:12-14`
- `packages/examples/src/03-policy-gated-assistant.ts:14-21`
- `packages/examples/src/05-full-assembly.ts:29-50`

That is consistent with the facade spec, which intentionally excludes transport and advanced internal types, but it means the examples package still carries direct package devDependencies (`packages/examples/package.json:10-15`) and the broader examples story is not fully "single package" outside the happy path.

Impact: the public adoption path is meaningfully simpler, but the repo's examples still teach a mixed model for advanced usage.

Follow-up: either make the mixed-entrypoint rule more explicit in the example headers/package metadata, or reshape advanced examples to avoid excluded types where practical.

## Assessment

### 1. Does the facade meaningfully simplify the public adoption path?

Yes.

Evidence:

- The facade package is a pure zero-logic barrel matching the intended shape (`packages/sdk/src/index.ts:1-94`).
- README quick start moved from multiple package installs/imports to `npm install @agent-assistant/sdk` and a single import source (`README.md:16-48`).
- A new hello-world example demonstrates the one-install path in actual code (`packages/examples/src/00-hello-world.ts:3-18`).
- The dedicated adoption guide clearly explains the facade, migration path, and exceptions (`docs/consumer/top-level-sdk-adoption-guide.md:8-29`, `353-406`).

This is a real reduction in adoption friction for new consumers.

### 2. Does it preserve modular package hygiene?

Yes.

Evidence:

- `packages/sdk/src/index.ts` contains only explicit `export` and `export type` statements, with no wrappers, helpers, or runtime behavior (`packages/sdk/src/index.ts:7-94`).
- The facade depends only on the six intended stable packages via normal package dependencies (`packages/sdk/package.json`).
- Advanced or unstable packages remain outside the facade and are documented as such in the adoption guide (`docs/consumer/top-level-sdk-adoption-guide.md:316-349`).

The main hygiene caveat is documentary, not architectural: one architecture doc still describes an older package boundary state.

### 3. Are the docs/examples aligned with the new public entrypoint?

Mostly, but not completely.

Aligned:

- README quick start (`README.md:16-48`)
- New adoption guide (`docs/consumer/top-level-sdk-adoption-guide.md`)
- New hello-world example (`packages/examples/src/00-hello-world.ts`)
- `how-to-build-an-assistant` now points readers at the facade path (`docs/consumer/how-to-build-an-assistant.md:25-29`)

Not fully aligned:

- `docs/architecture/package-boundary-map.md` still contains contradictory pre-facade guidance about traits and `AssistantDefinition` (`docs/architecture/package-boundary-map.md:149-165`)
- Advanced examples still require direct imports for intentionally excluded types (`packages/examples/src/01-minimal-assistant.ts:14`, `packages/examples/src/03-policy-gated-assistant.ts:20-21`, `packages/examples/src/05-full-assembly.ts:48-50`)

## Verification Performed

- Reviewed facade boundary doc: `docs/architecture/top-level-sdk-facade-implementation-boundary.md`
- Reviewed `packages/sdk` implementation and package metadata
- Reviewed changed README, consumer docs, and examples
- Ran `npm run build:sdk` successfully
- Ran `npm run typecheck -w @agent-assistant/examples` successfully

## Final Verdict

PASS_WITH_FOLLOWUPS

Reason: the facade implementation itself is correct and valuable. It clearly improves the public adoption path while preserving package boundaries. The remaining issues are follow-up alignment work in docs/examples, not blockers to the facade implementation.

Artifact produced:
- `docs/architecture/top-level-sdk-facade-implementation-review-verdict.md`

TOP_LEVEL_SDK_FACADE_IMPLEMENTATION_REVIEW_COMPLETE
