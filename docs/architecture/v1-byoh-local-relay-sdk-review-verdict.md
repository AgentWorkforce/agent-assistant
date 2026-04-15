# v1 BYOH Local Relay SDK Review Verdict

**Date:** 2026-04-15
**Scope reviewed:** first local BYOH proof slice against `docs/architecture/v1-byoh-local-relay-sdk-implementation-boundary.md`
**Verdict:** PARTIAL_ACCEPT

The slice is a credible first proof of the execution-adapter seam, but it does **not** yet satisfy the stronger claim that Agent Relay SDK is the central coordination substrate for the proof. The implementation proves local Claude Code execution plus bounded validation, but Relay-native collaboration is only partially exercised.

## Executive assessment

1. **Did the slice stay bounded?**
   Yes, mostly.

   Evidence:
   - The new implementation is concentrated in `packages/harness/src/adapter/*`, with the main additions being the adapter contract, Claude Code adapter, proof harness, and validation specialist.
   - The adapter remains bounded to one backend, `claude-code`, with explicit capability negotiation and no attempt to own assistant identity or continuation lifecycle in [packages/harness/src/adapter/claude-code-adapter.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/claude-code-adapter.ts:15) and [packages/harness/src/adapter/claude-code-adapter.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/claude-code-adapter.ts:267).
   - The harness package changes are narrow: package exports, dependencies needed for the proof, and test/build coverage in [packages/harness/package.json](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/package.json:1), [packages/harness/src/index.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/index.ts:1), and [packages/harness/tsconfig.json](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/tsconfig.json:1).

   Boundary caveat:
   - The proof runner carries a large custom `ProofTurnContextAssembler` shape instead of importing the canonical projection type directly in [packages/harness/src/adapter/proof/byoh-local-proof.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/byoh-local-proof.ts:21). That is still bounded, but it weakens the claim that the slice is anchored to the exact product/runtime contract rather than a local facsimile.

2. **Is Agent Relay SDK truly central to the proving setup?**
   Not yet.

   Evidence:
   - Relay use is optional in `runByohLocalProof`; the proof can run with no Relay transport at all in [packages/harness/src/adapter/proof/byoh-local-proof.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/byoh-local-proof.ts:303).
   - The only Relay SDK behavior implemented is a transport wrapper that starts `RelayAdapter` and publishes one message to a channel in [packages/harness/src/adapter/proof/byoh-local-proof.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/byoh-local-proof.ts:263).
   - Actual specialist coordination does not happen through Relay. The validation step is executed directly by the local coordinator via `coordinator.execute(...)` in [packages/harness/src/adapter/proof/byoh-local-proof.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/byoh-local-proof.ts:338).

   Why this matters:
   - The boundary document says Participant B should participate “through Relay SDK channels” and that the proof should use Relay SDK for workspace/channel/agent setup. The current slice publishes proof output to Relay, but the proving workflow is not actually dependent on Relay-native agent participation.

3. **Is Relay-native coordination preserved?**
   Partially, but not fully.

   Preserved:
   - The slice keeps a specialist role with bounded validation responsibility in [packages/harness/src/adapter/proof/validation-specialist.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/validation-specialist.ts:46).
   - Connectivity signals are emitted in the right shape for `confidence.high`, `confidence.low`, `escalation.uncertainty`, and `handoff.ready` in [packages/harness/src/adapter/proof/validation-specialist.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/validation-specialist.ts:92).

   Not preserved:
   - Those signals are produced inside the local coordinator/specialist path, not as a Relay-mediated interaction between registered Relay participants.
   - No Relay-native receipt, subscription, agent registration, or channel-driven specialist handoff is demonstrated.
   - `relayCoordinated` is effectively “Relay message published” rather than “coordination occurred through Relay” in [packages/harness/src/adapter/proof/byoh-local-proof.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/byoh-local-proof.ts:359).

4. **Is the slice genuinely useful for local proving?**
   Yes, but for a narrower claim than the boundary intended.

   What it proves well:
   - The execution-adapter seam is real and testable.
   - Claude Code CLI capabilities, negotiation, failures, timeout handling, and result normalization are concretely implemented and covered by tests in [packages/harness/src/adapter/claude-code-adapter.test.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/claude-code-adapter.test.ts:57).
   - The package itself builds and tests successfully when validated at the correct workspace scope:
     - `npm run build --workspace @agent-assistant/harness`
     - `npm run test --workspace @agent-assistant/harness`

   What it does not prove yet:
   - It does not prove that Relay SDK is the indispensable proving substrate.
   - It does not prove end-to-end Relay-native collaboration between orchestrator and specialist.

   Validation note:
   - The provided validation output complaining about missing `build` and `test` scripts is a **root package invocation issue**, not a slice failure. The root `package.json` lacks generic `build` and `test` scripts, while `packages/harness/package.json` defines both.

5. **What is the next continuation point?**
   The next slice should convert this from “Relay-adjacent proof harness” to “Relay-native proof harness.”

   Required continuation:
   - Make Relay participation mandatory for `runByohLocalProof` rather than optional.
   - Register the orchestrator and validation specialist as Relay participants for the proof session.
   - Route the validation handoff through Relay channel traffic, with the specialist consuming the execution result from Relay and returning its bounded verdict through Relay-visible coordination.
   - Keep `@agent-assistant/coordination` and `@agent-assistant/connectivity`, but make them observers/helpers around Relay-native message flow rather than the primary execution path.
   - Add one integration test that fails if Relay transport is removed, proving Relay is structurally central rather than cosmetic.

## Findings

### Finding 1
**Severity:** medium
**Issue:** Relay SDK is not central to coordination; it is currently an optional publication side-path.

Evidence:
 - `config.relay` / `config.relayConfig` are optional, and the proof still completes without Relay in [packages/harness/src/adapter/proof/byoh-local-proof.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/byoh-local-proof.ts:303).
 - The specialist is invoked directly through `coordinator.execute(...)` rather than through Relay channels in [packages/harness/src/adapter/proof/byoh-local-proof.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/byoh-local-proof.ts:338).

Impact:
 - The current slice does not fully meet the implementation boundary’s core proving thesis.

### Finding 2
**Severity:** low
**Issue:** The proof runner uses a local assembler interface replica instead of binding directly to the canonical turn-context projection contract.

Evidence:
 - `ProofTurnContextAssembler` redefines a substantial shape locally in [packages/harness/src/adapter/proof/byoh-local-proof.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/byoh-local-proof.ts:21).

Impact:
 - This is not a boundary break by itself, but it leaves room for drift between the proof harness and the real product-facing type contract.

## Final verdict

The first local BYOH proof slice is **bounded and useful**, and it successfully proves the local Claude Code execution-adapter path inside the harness package. It is **not yet sufficient** to claim that Agent Relay SDK is the central proving substrate or that Relay-native coordination has been preserved end-to-end.

The correct continuation point is to keep the current adapter work and refactor the proof harness so the specialist collaboration actually occurs through Relay-native participation rather than through direct local coordinator execution.

V1_BYOH_LOCAL_RELAY_SDK_REVIEW_COMPLETE
