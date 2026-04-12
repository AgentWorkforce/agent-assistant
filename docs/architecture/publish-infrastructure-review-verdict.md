# Publish Infrastructure Review Verdict — RelayAssistant

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

**Verdict: FAIL**

## Findings

1. **The release workflow is internally inconsistent on publish ordering, so the plan is not robust enough to execute as written.**
   [docs/architecture/publish-infrastructure-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/publish-infrastructure-contract.md:71) says build order matters and [docs/architecture/publish-infrastructure-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/publish-infrastructure-contract.md:73) requires parallel matrix publish for `all`. The implementation then codifies that parallel publish path in [docs/architecture/publish-infrastructure-implementation-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/publish-infrastructure-implementation-plan.md:292), while Phase 2 separately requires ordered publish `traits -> core -> sessions -> surfaces` in [docs/architecture/publish-infrastructure-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/publish-infrastructure-contract.md:221). Those are conflicting execution models.

2. **The workflow bootstrap is incomplete: it plans to run `npm ci`, but only adds a root `package.json`, not a lockfile.**
   The contract and implementation both rely on root `npm ci` as a mandatory gate in [docs/architecture/publish-infrastructure-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/publish-infrastructure-contract.md:177) and [docs/architecture/publish-infrastructure-implementation-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/publish-infrastructure-implementation-plan.md:192), with the CI workflow repeating that in [docs/architecture/publish-infrastructure-implementation-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/publish-infrastructure-implementation-plan.md:512). But P1-3 only creates a root `package.json` in [docs/architecture/publish-infrastructure-implementation-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/publish-infrastructure-implementation-plan.md:56); it does not require generating and committing a root `package-lock.json`. In the current repo there is no root `package.json` and no `package-lock.json`, so `npm ci` would still fail after P1-3 unless the plan is extended.

3. **The documented gate set is not what the proposed workflow actually implements.**
   The contract requires separate build and typecheck gates in [docs/architecture/publish-infrastructure-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/publish-infrastructure-contract.md:177), [docs/architecture/publish-infrastructure-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/publish-infrastructure-contract.md:178), and [docs/architecture/publish-infrastructure-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/publish-infrastructure-contract.md:180). The implementation's "Typecheck" step runs `npm run build` for every package instead in [docs/architecture/publish-infrastructure-implementation-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/publish-infrastructure-implementation-plan.md:207). That means the plan is not yet precise enough to trust as the implementation source of truth.

4. **The Workforce direct-consumption blocker is stated explicitly, but incorrectly.**
   The docs claim `@agentworkforce/workload-router` "contains routing profiles, NOT personas" in [docs/architecture/publish-infrastructure-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/publish-infrastructure-contract.md:105) and [docs/architecture/workforce-profile-consumption-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/workforce-profile-consumption-plan.md:30). That is false. The published `@agentworkforce/workload-router` package exists in [/Users/khaliqgant/Projects/AgentWorkforce/workforce/packages/workload-router/package.json](/Users/khaliqgant/Projects/AgentWorkforce/workforce/packages/workload-router/package.json:2), imports `npm-provenance-publisher.json` directly in [/Users/khaliqgant/Projects/AgentWorkforce/workforce/packages/workload-router/src/index.ts](/Users/khaliqgant/Projects/AgentWorkforce/workforce/packages/workload-router/src/index.ts:13), includes it in `personaCatalog` in [/Users/khaliqgant/Projects/AgentWorkforce/workforce/packages/workload-router/src/index.ts](/Users/khaliqgant/Projects/AgentWorkforce/workforce/packages/workload-router/src/index.ts:384), and exposes `resolvePersona('npm-provenance')` plus `materializeSkillsFor(...)` in [/Users/khaliqgant/Projects/AgentWorkforce/workforce/packages/workload-router/src/index.ts](/Users/khaliqgant/Projects/AgentWorkforce/workforce/packages/workload-router/src/index.ts:409). Direct programmatic consumption is therefore already available, even if raw JSON import is not.

5. **The OIDC security requirements were extracted inaccurately, which weakens the implementation guidance.**
   The Workforce persona explicitly says to use OIDC trusted publishing with "no long-lived `NPM_TOKEN`" and to verify `contents: read` with `id-token: write` in [/Users/khaliqgant/Projects/AgentWorkforce/workforce/personas/npm-provenance-publisher.json](/Users/khaliqgant/Projects/AgentWorkforce/workforce/personas/npm-provenance-publisher.json:16). The RelayAssistant docs instead normalize on `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` in [docs/architecture/publish-infrastructure-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/publish-infrastructure-contract.md:67) and [docs/architecture/publish-infrastructure-implementation-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/publish-infrastructure-implementation-plan.md:344), then describe that as a profile-derived requirement in [docs/architecture/publish-infrastructure-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/publish-infrastructure-contract.md:139). That is not a faithful extraction.

## Assessment Against Requested Questions

1. **Is the release plan robust and realistic?**
   No. The package selection is sensible, but the execution plan has unresolved contradictions around publish ordering, bootstrap prerequisites for `npm ci`, and the exact CI gates.

2. **Does it avoid publishing unready packages?**
   Mostly yes at the policy level. The readiness matrix correctly keeps `routing`, `connectivity`, `coordination`, `memory`, `policy`, and `proactive` out of the initial release set in [docs/architecture/publish-package-readiness-matrix.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/publish-package-readiness-matrix.md:13). The problem is that the workflow plan itself is not yet reliable enough to be the enforcement mechanism.

3. **Does it require direct Workforce package/profile consumption rather than a copied local fallback?**
   It states that requirement clearly in [docs/architecture/publish-infrastructure-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/publish-infrastructure-contract.md:97) and [docs/architecture/workforce-profile-consumption-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/workforce-profile-consumption-plan.md:10), and it correctly rejects copying persona content into this repo. But it does not choose the actual direct-consumption path already available through `@agentworkforce/workload-router`.

4. **If direct consumption is blocked, does it identify the blocker explicitly and correctly?**
   It identifies a blocker explicitly, but not correctly. Raw JSON package export is absent, but direct programmatic consumption is not blocked because `@agentworkforce/workload-router` already embeds the persona and exposes a typed API for consuming it.

5. **Is this strong enough to drive implementation next?**
   Not yet. It is close on package readiness policy, but it needs one more design pass to remove contradictions and replace the incorrect Workforce-blocker narrative with the real integration path.

## Required Follow-Ups Before Implementation

- Replace the false `BLOCKER-WF-001` claim with the actual current path: consume the Workforce persona through `@agentworkforce/workload-router`, likely via `resolvePersona('npm-provenance')` and `materializeSkillsFor(...)`.
- Decide on one publish strategy for `all`: either true ordered publish or true independent parallel publish. Do not keep both.
- Add the missing workspace bootstrap requirements: root `package.json`, generated root `package-lock.json`, and any root scripts needed for `npm ci` and workspace commands.
- Make the workflow gates match the contract exactly, or narrow the contract to what will actually run.
- Reconcile the security model with the Workforce persona: OIDC trusted publishing should not be documented as depending on a long-lived `NPM_TOKEN`.

## Bottom Line

The package readiness gating is directionally sound, and the docs do avoid a copied local persona fallback. The plan still fails review because the release workflow is not internally coherent enough to implement safely, and the claimed Workforce consumption blocker is materially incorrect.

Artifact produced: [docs/architecture/publish-infrastructure-review-verdict.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/publish-infrastructure-review-verdict.md)

PUBLISH_INFRASTRUCTURE_REVIEW_COMPLETE
