# SPEC: BYOH Harness Adapter Architecture and SDK Completion

Last updated: 2026-04-14
Target release: 0.2.0

## 0. Executive Summary

This repo already has strong product-side building blocks: `traits`, `core`, `sessions`, `surfaces`, `turn-context`, `policy`, `proactive`, `routing`, `connectivity`, and `coordination`. The missing step is not a framework rewrite. It is a clean execution seam.

The governing rule is:

> Separate product identity from execution.

That means:

- Product-owned packages decide identity, context assembly, routing, policy, continuation lifecycle, and delivery.
- A harness adapter translates a canonical execution request into a concrete backend and translates the result back.
- The adapter does not own policy, memory, sessions, coordination, proactive follow-up, or a global tool registry.

V1 is complete only when the repo's own first-party harness goes through the same adapter contract that any external backend would use. If the built-in harness bypasses the seam, BYOH is not real.

## 1. Current Repo Snapshot

This section is intentionally concrete. It is based on the repo state as validated on 2026-04-14.

### 1.1 Workspace and Package Facts

- Root workspaces currently include:
  `traits`, `core`, `harness`, `continuation`, `turn-context`, `sessions`, `surfaces`, `routing`, `connectivity`, `coordination`, `proactive`, `policy`, `integration`, `sdk`, `examples`.
- `packages/memory` exists on disk but is not listed in the root `workspaces` array.
- `packages/integration` is a private proof package named `@agent-assistant/integration-tests`; it is not a runtime SDK package.
- The root `package.json` currently exposes only one script: `build:sdk`.

### 1.2 Build / Packaging Reality

`dist/` is currently present for:

- `@agent-assistant/continuation`
- `@agent-assistant/core`
- `@agent-assistant/harness`
- `@agent-assistant/sdk`
- `@agent-assistant/traits`
- `@agent-assistant/turn-context`

`dist/` is currently missing for:

- `@agent-assistant/connectivity`
- `@agent-assistant/coordination`
- `@agent-assistant/memory`
- `@agent-assistant/policy`
- `@agent-assistant/proactive`
- `@agent-assistant/routing`
- `@agent-assistant/sessions`
- `@agent-assistant/surfaces`

`@agent-assistant/examples` and `@agent-assistant/integration-tests` are private packages and do not need publishable `dist`, but they still need deterministic `typecheck` and `test` behavior.

### 1.3 Test / Pack Observations

Validated observations:

- `npm test -w @agent-assistant/coordination` fails from a clean state when `@agent-assistant/connectivity` has no built output.
- After `npm run build -w @agent-assistant/connectivity`, the same coordination suite passes (`39` tests).
- `npm pack --dry-run -w @agent-assistant/connectivity` and `npm pack --dry-run -w @agent-assistant/routing` produce tarballs containing only `README.md` and `package.json` when `dist/` is absent.
- `npm pack --dry-run -w @agent-assistant/sdk` and `npm pack --dry-run -w @agent-assistant/turn-context` include built artifacts as expected.

### 1.4 Implications

Before adding BYOH capabilities, the repo needs basic release discipline:

1. Public packages must either build before packing or fail loudly.
2. Tests must pass from a clean checkout without relying on manually prebuilt sibling packages.
3. The repo must decide whether `memory` is an official package for 0.2.0, or an experimental package that should stay outside the supported workspace.

## 2. Governing Rule, Scope, and Non-Goals

### 2.1 Governing Rule

Separate product identity from execution.

Product identity includes:

- assistant traits and persona
- session affinity and surface attachment
- turn-context assembly
- routing and mode selection
- policy and approvals
- continuation persistence and resume delivery
- proactive behavior
- multi-agent coordination

Execution includes:

- bounded turn execution
- model/tool loop mediation
- backend-native approvals or interrupts
- backend-native trace collection
- translation to and from backend-specific formats

### 2.2 Scope

This spec covers:

- a BYOH adapter architecture
- the remaining implementation work required to make the SDK coherent
- how existing packages fit into the BYOH model
- implementation phases with priorities and exit criteria
- what to adopt from OpenHarness, OpenClaw, pi, Claude Code, DeepAgents, and Open Agents

### 2.3 Non-Goals

This work does not require:

- rewriting `core`
- merging packages into one monolith
- moving policy into the harness
- moving continuation storage into the adapter
- inventing a global tool registry owned by the adapter
- making streaming mandatory for v1

## 3. Target BYOH Architecture

### 3.1 High-Level Shape

```text
Product Runtime
  - identity
  - turn-context
  - routing
  - policy
  - continuation lifecycle
  - delivery
  - coordination / proactive / memory enrichment
          |
          v
Canonical Execution Contract
  ExecutionRequest
  ExecutionCapabilities
  ExecutionNegotiation
  ExecutionResult
          |
          v
ExecutionAdapter
  BuiltInHarnessAdapter
  ExternalAdapterA
  ExternalAdapterB
          |
          v
Concrete Backend / Harness
```

The adapter is a seam, not a product layer. It should stay thin. If adapter code starts accumulating routing policy, stateful resume logic, or cross-turn memory behavior, the architecture has regressed.

### 3.2 Ownership Boundaries

| Area | Product Runtime Owns | Adapter Owns | Backend Owns |
| --- | --- | --- | --- |
| Assistant identity | yes | no | no |
| Turn-context assembly | yes | no | no |
| Tool selection per turn | yes | no | no |
| Tool call translation / mediation | no | yes | partially |
| Model/tool loop execution | no | yes | yes |
| Policy / approvals policy | yes | no | no |
| Native interrupt plumbing | no | yes | yes |
| Continuation persistence | yes | no | no |
| Session lifecycle | yes | no | no |
| Surface delivery | yes | no | no |
| Coordination / delegation | yes | no | no |
| Trace normalization | no | yes | partially |

### 3.3 Canonical Contract

V1 should introduce a new package:

- `@agent-assistant/execution-adapter`

Core types:

```ts
export interface ExecutionAdapter {
  readonly backendId: string;
  describeCapabilities(): ExecutionCapabilities;
  negotiate(request: ExecutionRequest): ExecutionNegotiation;
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
}
```

Recommended request shape:

```ts
export interface ExecutionRequest {
  schemaVersion: 'execution-request.v1';
  ids: {
    assistantId: string;
    turnId: string;
    sessionId?: string;
    userId?: string;
    threadId?: string;
    traceId?: string;
  };
  message: {
    id: string;
    text: string;
    receivedAt: string;
    attachments?: ExecutionAttachment[];
  };
  instructions: {
    systemPrompt: string;
    developerPrompt?: string;
    responseStyle?: Record<string, unknown>;
  };
  context?: {
    blocks: ExecutionContextBlock[];
    structured?: Record<string, unknown>;
  };
  tools?: ExecutionToolDefinition[];
  continuation?: ExecutionContinuationInput;
  requirements?: ExecutionRequirements;
  metadata?: Record<string, unknown>;
}
```

Recommended result shape:

```ts
export interface ExecutionResult {
  schemaVersion: 'execution-result.v1';
  backendId: string;
  status:
    | 'completed'
    | 'needs_clarification'
    | 'awaiting_approval'
    | 'deferred'
    | 'failed'
    | 'unsupported';
  output?: {
    text?: string;
    structured?: Record<string, unknown>;
  };
  toolTrace?: ExecutionToolTrace[];
  continuation?: ExecutionContinuationOutput;
  approvalRequest?: ExecutionApprovalRequest;
  degradation?: ExecutionDegradation;
  error?: ExecutionError;
  trace: ExecutionTrace;
}
```

The key is not the exact field names. The key is that these types are adapter-neutral and stable enough for `routing`, `policy`, `continuation`, and the SDK facade to depend on.

### 3.4 Capability Negotiation

Capabilities must be richer than booleans.

Recommended capability model:

| Capability | Values | Notes |
| --- | --- | --- |
| `toolUse` | `none` / `adapter-mediated` / `native-iterative` | Distinguishes translation-only backends from harnesses that run their own loop |
| `continuationSupport` | `none` / `opaque-resume` / `structured` | Structured continuation is preferred |
| `approvalInterrupts` | `none` / `adapter-mediated` / `native` | Native interrupt support is strongest |
| `streaming` | `none` / `token` / `event` | V1 may leave execution batch-only, but capabilities should model this now |
| `attachments` | `none` / `input-only` / `input-output` | Avoid fake attachment support |
| `traceDepth` | `minimal` / `standard` / `detailed` | Needed for debugging and conformance |
| `sandbox` | `none` / `shared` / `isolated` | Distinguishes plain model calls from code-executing environments |
| `maxContextStrategy` | `small` / `medium` / `large` / `unknown` | Used for routing and graceful degradation |

`negotiate()` should return:

- `supported: boolean`
- `degraded: boolean`
- `reasons: ExecutionNegotiationReason[]`
- `effectiveCapabilities: ExecutionCapabilities`

`negotiate()` must be side-effect free. It is a planning step, not execution.

### 3.5 Truthful Degradation Rules

The SDK must not flatten missing capabilities into fake success.

Examples:

- A backend that can only emit plain text asking for approval does not have native approval interrupts.
- A backend that exposes a transcript dump does not necessarily provide structured trace depth.
- A backend that can accept file URLs but not return structured attachment outputs should not claim full attachment support.

If a required feature is missing:

- `supported` must be `false`, or
- `status` must be `unsupported`

If an optional feature is missing:

- `degraded` must be `true`
- the missing feature must be described in machine-readable `reasons[]`

The product runtime decides whether to continue, retry, reroute, or surface the degradation to the user.

### 3.6 Tool Mediation, Not Tool Registry

Tool choice remains upstream.

The product runtime chooses tools for a turn and sends them in `ExecutionRequest.tools[]`.

The adapter is responsible for:

1. translating tool schemas into the backend's format
2. running the tool-call loop when the backend requires adapter mediation
3. translating tool outputs back into canonical trace / result shapes

The adapter is not responsible for:

- long-lived tool registration policy
- global discovery of all product tools
- deciding which tools are allowed for the turn

### 3.7 Continuation Boundary

The adapter may emit resumable outcomes. It may not own the continuation lifecycle.

Adapter responsibilities:

- emit `needs_clarification`, `awaiting_approval`, or `deferred`
- include continuation payloads needed for resume

Product responsibilities:

- persist continuation records
- map resume triggers to stored continuation state
- deliver follow-up prompts and resumed outputs
- decide expiration, retry bounds, and delivery suppression

### 3.8 Versioning, Trace, and Timeout Semantics

V1 contract types must include:

- explicit schema versions
- correlation identifiers (`assistantId`, `turnId`, `sessionId`, optional `traceId`)
- start / end timestamps
- timeout / cancellation semantics

The adapter must return a structured timeout error instead of silently hanging or partially succeeding.

### 3.9 V1 Compatibility Rule

V1 should preserve backward compatibility where practical:

- `turn-context` may continue to expose `harnessProjection` temporarily
- `continuation` may continue to accept `HarnessResult` temporarily

But the migration direction must be explicit:

- new code depends on `ExecutionRequest` / `ExecutionResult`
- harness-specific public types become compatibility shims, not the long-term center of gravity

## 4. What Needs to Be Implemented to Complete the SDK

This section is the actionable plan, not a wish list.

### 4.1 Repo Hygiene and Release Plumbing

These items must land before the BYOH claim is credible:

1. Add root scripts for `build`, `test`, `typecheck`, and `pack:check`.
2. Ensure every public package either builds `dist/` before packing or fails loudly during `pack:check`.
3. Fix clean-checkout test behavior so coordination does not require a manually prebuilt sibling package.
4. Decide `memory` package status:
   - option A: add it to the workspace and support it in 0.2.0
   - option B: explicitly mark it experimental and exclude it from the release plan
5. Keep `packages/integration` test-only; do not promote it into a runtime package.

Recommended root scripts:

```json
{
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "pack:check": "npm pack --dry-run -w @agent-assistant/traits && npm pack --dry-run -w @agent-assistant/core && npm pack --dry-run -w @agent-assistant/harness && npm pack --dry-run -w @agent-assistant/continuation && npm pack --dry-run -w @agent-assistant/turn-context && npm pack --dry-run -w @agent-assistant/sessions && npm pack --dry-run -w @agent-assistant/surfaces && npm pack --dry-run -w @agent-assistant/routing && npm pack --dry-run -w @agent-assistant/connectivity && npm pack --dry-run -w @agent-assistant/coordination && npm pack --dry-run -w @agent-assistant/proactive && npm pack --dry-run -w @agent-assistant/policy && npm pack --dry-run -w @agent-assistant/sdk"
  }
}
```

The exact script shape can be cleaner than this. The important part is that release validation becomes repeatable from the repo root.

### 4.2 New Package: `@agent-assistant/execution-adapter`

This is the main new implementation package.

Deliverables:

1. Canonical adapter-neutral types
2. `ExecutionAdapter` interface
3. `BuiltInHarnessAdapter`
4. Conformance test helpers
5. Optional helper constructors for adapters

Non-goals for this package:

- no routing policy
- no global adapter registry
- no continuation storage
- no surface delivery

### 4.3 Package-by-Package Completion Criteria

| Package | Current Role | Current State | Required BYOH Work | Exit Gate |
| --- | --- | --- | --- | --- |
| `traits` | identity floor | solid | no structural change | included in examples and docs |
| `core` | generic runtime shell | already execution-agnostic | keep it generic; do not push adapter logic down here | no new execution coupling added |
| `harness` | first-party bounded turn runtime | strong foundation | wrap it with `BuiltInHarnessAdapter`; do not make product packages depend on it more deeply | built-in adapter passes conformance suite |
| `continuation` | continuation lifecycle | public API currently imports harness types | add `fromExecutionResult()` bridge; introduce adapter-neutral seed types; deprecate harness-centric public entry points over time | continuation can be created from canonical result |
| `turn-context` | turn assembly | currently exposes `harnessProjection` and depends on `@agent-assistant/harness` | add canonical `toExecutionRequest()` or equivalent projector; phase down direct harness coupling | public assembly can feed adapter-neutral execution |
| `sessions` | session state | packaging only partially ready | no architecture change; ensure build / export readiness | package builds and packs cleanly |
| `surfaces` | inbound/outbound surface handling | packaging only partially ready | no architecture change; add example showing delivery stays above adapter | package builds and packs cleanly |
| `routing` | mode/model selection | currently not adapter-aware | add adapter-aware routing and negotiation inputs; allow route decisions to consider capabilities and degradation | routing selects adapter + model coherently |
| `connectivity` | signaling / escalation | build/export fragility from clean state | make clean-checkout build/test deterministic; keep it product-side only | coordination tests pass from clean checkout |
| `coordination` | multi-agent delegation | logic exists, tests depend on prebuilt sibling | keep it upstream of execution; allow specialist output to influence enrichment or routing hints, not adapter internals | clean-checkout tests pass |
| `proactive` | follow-up engine | solid product-side boundary | no adapter coupling; continue to operate on continuation / delivery layer | no execution coupling added |
| `policy` | pre-execution gate | solid boundary, packaging incomplete | map permission model onto adapter capabilities and tool requirements | approval / denial path proven E2E |
| `integration` | proof package | currently private tests only | expand to host adapter conformance and cross-package E2E proofs | proof suite covers BYOH flow |
| `sdk` | top-level facade | only re-exports wave-1 baseline | export `execution-adapter` and add clear subpath exports for advanced packages | facade is coherent for 0.2.0 |
| `examples` | reference usage | v1 examples only | add BYOH examples using built-in adapter and one degraded flow | examples compile and reflect target architecture |
| `memory` | enrichment candidate | on disk, outside workspace, external dep | either formalize it for 0.2.0 or explicitly defer it; do not leave it half-supported | explicit decision recorded and reflected in workspace |

### 4.4 Important Migration Corrections

The current repo has two public seams that are too harness-centric for a BYOH future:

1. `turn-context` currently depends on `@agent-assistant/harness`.
2. `continuation` currently imports `HarnessContinuation` and `HarnessResult`.

That is acceptable as a transitional v1 compatibility layer. It is not acceptable as the end state.

Required direction:

- `turn-context` becomes canonical product assembly, with optional projection helpers
- `execution-adapter` becomes the only place that knows how to talk to a concrete backend
- `continuation` becomes capable of consuming canonical execution results without requiring harness-native types

### 4.5 Adapter Conformance Suite

Any adapter must pass a shared suite with at least these assertions:

1. `describeCapabilities()` returns a fully populated manifest.
2. `negotiate()` reports unsupported required capabilities honestly.
3. `negotiate()` reports degraded optional capabilities honestly.
4. `negotiate()` is side-effect free.
5. `execute()` returns `completed` for a basic turn.
6. `execute()` returns canonical tool trace for a tool-bearing turn.
7. `execute()` returns `needs_clarification` with resumable payload.
8. `execute()` returns `awaiting_approval` with approval payload.
9. `execute()` returns structured timeout / backend failure errors.
10. `execute()` returns `unsupported` instead of faking support.

## 5. Integrating Existing Packages Into the BYOH Framework

### 5.1 Target Flow

```text
Inbound surface event
  -> core runtime dispatch
  -> sessions / traits lookup
  -> turn-context assembly
  -> policy pre-check
  -> routing chooses mode + model + adapter candidate
  -> adapter negotiation
  -> adapter execution
  -> canonical execution result
  -> continuation creation if resumable
  -> proactive / delivery decisions
  -> surfaces emit output
```

### 5.2 Where Each Package Sits

Above the adapter seam:

- `traits`
- `core`
- `sessions`
- `surfaces`
- `turn-context`
- `routing`
- `policy`
- `continuation`
- `proactive`
- `connectivity`
- `coordination`
- `memory` if kept

At the seam:

- `execution-adapter`

Below the seam:

- `harness`
- any external execution backend

Proof / validation:

- `integration`
- `examples`

### 5.3 Built-In Harness Adapter

The first adapter should wrap the existing harness with minimal translation code.

Sketch:

```ts
export class BuiltInHarnessAdapter implements ExecutionAdapter {
  readonly backendId = 'built-in-harness';

  describeCapabilities(): ExecutionCapabilities {
    return {
      toolUse: 'native-iterative',
      continuationSupport: 'structured',
      approvalInterrupts: 'native',
      streaming: 'none',
      attachments: 'input-only',
      traceDepth: 'detailed',
      sandbox: 'none',
      maxContextStrategy: 'large',
      schemaVersion: 'execution-capabilities.v1',
    };
  }

  negotiate(request: ExecutionRequest): ExecutionNegotiation {
    // validate requested attachments, tools, and limits
    // return supported/degraded/effectiveCapabilities
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    // translate ExecutionRequest -> HarnessTurnInput
    // invoke harness runtime
    // translate HarnessResult -> ExecutionResult
  }
}
```

Target size:

- translation code: roughly 100 to 200 lines
- no policy, routing, session, or continuation storage logic inside

### 5.4 Routing Integration

`routing` currently selects modes and model hints. It needs one more layer:

- adapter choice

Recommended new responsibility:

```ts
type AdapterRoutingDecision = {
  mode: RoutingMode;
  modelSpec: ModelSpec;
  adapterId: string;
  negotiationRequired: boolean;
  reason: RoutingReason;
  escalated: boolean;
};
```

Routing should consider:

- requested capability level
- cost / latency constraints
- adapter capability manifests
- truthful degradation from negotiation

Routing should not instantiate adapters. It should select among adapters provided by the caller or runtime.

### 5.5 Policy Integration

`policy` remains above the seam.

Policy should evaluate:

- whether a requested tool is allowed at all
- whether a tool requires approval before execution
- whether a backend with a weaker approval model is acceptable for the turn

The adapter can expose capability facts and tool metadata. Policy makes the decision.

### 5.6 Continuation Integration

Required changes:

1. Add a bridge from `ExecutionResult` to continuation creation input.
2. Preserve current harness-centric entry points as compatibility shims only.
3. Keep resume delivery and persistence above the seam.

Suggested bridge:

```ts
createContinuationFromExecutionResult(result: ExecutionResult, options: {
  assistantId: string;
  sessionId?: string;
  threadId?: string;
  userId?: string;
}): CreateContinuationInput | null
```

### 5.7 Turn-Context Integration

Required changes:

1. Add canonical execution projection.
2. Keep existing `harnessProjection` temporarily.
3. Mark harness projection as compatibility behavior, not the target API.

Important rule:

`turn-context` should describe the turn. It should not decide how a concrete backend consumes it.

### 5.8 Connectivity / Coordination / Memory Integration

These packages stay upstream and contribute enrichment, not execution mechanics.

- `connectivity` can raise escalation signals that affect routing mode.
- `coordination` can produce specialist output that becomes enrichment candidates or tool-selection hints.
- `memory` can retrieve turn-scoped memory candidates that `turn-context` projects into context blocks.

None of these packages should call an adapter directly unless a product runtime deliberately orchestrates that flow.

## 6. Implementation Phases

Each phase has a priority and an exit gate.

### Phase 0: Repo Hygiene and Release Readiness

Priority: critical
Estimated effort: 1 to 2 days

Work:

- add root `build`, `test`, `typecheck`, and `pack:check`
- make public package packing deterministic
- fix clean-checkout coordination test behavior
- decide `memory` package status and reflect that in the workspace
- align version / publish expectations across packages

Exit gate:

- `npm run build`
- `npm run test`
- `npm run typecheck`
- `npm run pack:check`

all pass from a clean checkout.

### Phase 1: Canonical Adapter Contract and Built-In Proof

Priority: critical
Estimated effort: 3 to 5 days

Work:

- create `@agent-assistant/execution-adapter`
- implement canonical types
- implement `BuiltInHarnessAdapter`
- add conformance test helpers
- add schema version and trace propagation
- add timeout semantics

Exit gate:

- built-in harness passes the shared conformance suite
- one unsupported case and one degraded case are explicitly proven

### Phase 2: Product Integration

Priority: high
Estimated effort: 3 to 5 days

Work:

- add adapter-aware routing
- add turn-context canonical execution projection
- add continuation bridge from canonical result
- update SDK exports
- add end-to-end integration proof from turn-context through delivery

Exit gate:

- full pipeline test passes:
  `turn-context -> routing -> negotiate -> execute -> continuation -> delivery`

### Phase 3: Second Adapter Proof

Priority: high
Estimated effort: 5 to 7 days

Work:

- implement one external adapter
- recommended goal: choose the backend that best stress-tests truthful degradation
- preferred options:
  - Claude-family backend if approval / interrupt behavior is the main proof target
  - Codex / provider API backend if simpler external execution proof is preferred

Exit gate:

- second adapter passes the same conformance suite
- at least one capability is honestly weaker than the built-in harness and is handled correctly end-to-end

### Phase 4: Enrichment Completion

Priority: medium
Estimated effort: 3 to 5 days

Work:

- finalize memory decision and wire memory into turn-context if included
- wire coordination outputs into turn-context or routing hints
- prove connectivity escalation can influence routing without leaking into adapter logic

Exit gate:

- enrichment-driven integration test passes

### Phase 5: Facade, Examples, and Release

Priority: final gate
Estimated effort: 2 to 3 days

Work:

- update `@agent-assistant/sdk` exports
- add BYOH examples
- write adapter authoring guide
- update package versions for 0.2.0
- tag and release

Exit gate:

- examples compile
- public docs reflect the new architecture
- 0.2.0 packages pack and publish cleanly

## 7. What to Adopt From Reference Frameworks

The reference frameworks are useful only insofar as they reinforce the governing rule. If a pattern conflicts with separation of product identity from execution, the pattern loses.

### 7.1 Adoption Matrix

| Source | Adopt | Do Not Adopt | Application Here |
| --- | --- | --- | --- |
| OpenHarness / ECC | portable workflow, skills, and policy packaging across harnesses | any design that turns the adapter seam into a large middleware stack | keep shared policy / workflow concepts above the backend and make adapter packaging portable |
| OpenClaw | gateway-owned discovery, pairing, ACLs, and clear control-plane ownership | moving long-lived state into execution clients | model adapter discovery and capability self-description as product/control-plane concerns, not backend side effects |
| pi | persona continuity and conversational layering | consumer-product UX assumptions in the SDK core | keep persona and memory shaping in `traits` + `turn-context`, not in the adapter |
| Claude Code | iterative tool loop, deterministic stop reasons, permission-aware execution model | monolithic CLI coupling as the SDK center | map permission levels into `policy` and keep deterministic stop semantics in the canonical result |
| DeepAgents | planning/decomposition, context offloading, pluggable backends, permission rules, HITL | making every turn pay the cost of heavy orchestration | let `coordination`, `memory`, and routing own complexity only when needed |
| Open Agents | durable workflow-backed execution, streaming/cancellation, separation of agent logic from sandbox lifecycle | Vercel-specific deployment assumptions | keep execution durable and separable from environment lifecycle; add streaming later without baking runtime lock-in into v1 |

### 7.2 Specific Takeaways

#### OpenHarness / ECC

Adopt:

- portable config / workflow packaging
- shared skills and policy above individual harnesses

Do not adopt:

- large abstraction layers inside the adapter itself

Repo effect:

- the adapter contract should be small and portable
- cross-harness consistency belongs in product packages and docs

#### OpenClaw

Adopt:

- explicit control-plane ownership
- discovery / pairing / admission handled by the gateway, not by incidental clients

Do not adopt:

- embedding long-lived product state inside the execution backend boundary

Repo effect:

- adapter capability registration and selection should be explicit and inspectable
- product runtime remains the source of truth for state and routing

#### pi

Adopt:

- persistent personality shaping
- continuity of voice and relationship over time

Do not adopt:

- product-specific consumer interaction patterns as SDK primitives

Repo effect:

- `traits` and `turn-context` should own persona layering
- no adapter should encode product personality rules

Note:

- This row is an architectural inference from Pi's public positioning as a personal conversational AI, not from a public SDK contract.

#### Claude Code

Adopt:

- permission-aware execution
- iterative tool-use loops
- truthful stop reasons

Do not adopt:

- CLI coupling as a core dependency of the SDK architecture

Repo effect:

- `policy` should stay the owner of allow / deny / approve / escalate
- `ExecutionResult.status` should preserve deterministic stop semantics

#### DeepAgents

Adopt:

- planning and subagent decomposition when tasks are genuinely complex
- pluggable backends and filesystem / sandbox abstractions
- declarative permission rules

Do not adopt:

- heavyweight orchestration for ordinary turns

Repo effect:

- keep coordination optional and upstream
- do not overload the adapter with planning or memory responsibilities

#### Open Agents

Adopt:

- durable execution that is not tied to a single request lifecycle
- streaming and cancellation as first-class concerns
- separation between agent logic and environment lifecycle

Do not adopt:

- hosting-provider-specific assumptions in core contracts

Repo effect:

- keep `execute()` batch-based in v1 if needed, but design the contract so streaming can be added without a breaking rewrite
- keep sandboxes and execution environments behind adapter capabilities

## 8. Acceptance Checklist for 0.2.0

The SDK is ready for a BYOH-oriented 0.2.0 release when all of the following are true:

- public packages build and pack cleanly from a fresh checkout
- built-in harness uses the adapter seam rather than bypassing it
- `turn-context` can produce adapter-neutral execution input
- `continuation` can consume adapter-neutral execution output
- routing can choose among adapters using capability facts
- policy remains above the seam and approval flows work end-to-end
- at least one non-built-in adapter passes the same conformance suite
- examples and facade exports reflect the new architecture

## 9. References

The framework takeaways above were informed by these public references:

- HARNESS_RECOMMENDATIONS.md
- HARNESS_FEEDBACK.md
- ECC Tools platforms page: `https://ecc.tools/platforms`
- OpenClaw home and docs: `https://openclaw.ai`, `https://docs.openclaw.ai/gateway/discovery`
- Claude Code docs: `https://code.claude.com/docs/en/common-workflows`
- Deep Agents overview: `https://docs.langchain.com/oss/python/deepagents/overview`
- Open Agents template page: `https://vercel.com/templates/template/open-agents`
- Pi public site / company positioning: `https://pi.ai`, `https://inflection.ai/notice-on-model-training`

Where a source is a product page rather than a formal API spec, the recommendation here is architectural inference, not a claim of direct API compatibility.
