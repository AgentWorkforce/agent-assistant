# Direct Execution Backend Decision

Date: 2026-04-17
Status: Proposed

## Decision

Agent Assistant should proceed with a direct execution strategy built around two explicit backend families:

1. **API execution backend** for hosted model APIs, starting with direct OpenRouter support
2. **Harness BYOH execution backend** for local or external execution harnesses such as Claude Code CLI

Agent Assistant should **not** adopt `@mariozechner/pi-ai` as the execution substrate at this time.

## Why this decision exists

The execution/backend direction had become fuzzy across several overlapping ideas:
- direct provider/API support
- OpenRouter as the likely hosted path
- BYOH for local CLI harnesses
- possible reuse of external multi-provider substrate libraries

That ambiguity creates drift in package boundaries and implementation priorities. This decision locks the next implementation direction so the SDK can keep moving without repeated re-litigation.

## Chosen architecture

### 1. API backend family

This backend family owns execution against hosted model APIs.

Initial target:
- **OpenRouter**

Responsibilities:
- invoke hosted model APIs for one bounded assistant turn
- map product-prepared execution requests into provider/API requests
- normalize responses back into Agent Assistant execution semantics
- report capabilities and degradation honestly

Non-responsibilities:
- assistant identity
- turn-context assembly
- policy ownership
- continuation semantics
- Relay-native communication/collaboration

### 2. Harness BYOH backend family

This backend family owns execution through local or external harnesses.

Initial targets:
- Claude Code CLI
- future Codex CLI / similar harnesses if needed

Responsibilities:
- launch and manage one bounded external execution backend through the execution adapter seam
- normalize output into canonical execution results
- report capability limits honestly

Non-responsibilities:
- hosted API aggregation
- provider-breadth ownership
- collaboration-plane replacement

## Architectural rule

**BYOH changes execution, not collaboration.**

Relay-native communication remains the collaboration fabric.
Turn-context, policy, continuation, and product identity remain Agent Assistant responsibilities.
Execution adapters only decide how a bounded turn is handed to a backend and how the result is normalized back.

## Why not use pi-ai now

`@mariozechner/pi-ai` is promising as a multi-provider API substrate, but it is not the right center of gravity for the current product direction.

Reasons:
1. Current hosted priority is narrow: **OpenRouter**, not broad provider breadth
2. Current BYOH priority is **local harness execution**, which pi-ai does not solve well
3. Adopting pi-ai now would add an extra dependency/abstraction layer without solving the core harness BYOH path
4. The most important work is preserving Agent Assistant execution semantics and backend boundaries, not outsourcing model-provider breadth prematurely

This is not a permanent rejection of pi-ai. It is a decision that it should not define the next implementation slice.

## Package boundary implications

### Agent Assistant continues to own
- `@agent-assistant/traits`
- `@agent-assistant/turn-context`
- `@agent-assistant/policy`
- `@agent-assistant/continuation`
- `@agent-assistant/harness`
- execution adapter contracts in the harness/adapter seam
- Relay-native coordination and specialist collaboration contracts

### Execution backends should own
- backend-specific request mapping
- backend-specific auth/transport behavior
- backend-specific output normalization
- capability negotiation and degradation reporting at backend granularity

## Immediate implementation direction

### A. Direct OpenRouter backend
Build a direct Agent Assistant execution adapter/backend for OpenRouter-backed hosted execution.

This should:
- honor `ExecutionAdapter` contracts
- support truthful capability negotiation
- normalize hosted model output into `ExecutionResult`
- stay separate from harness BYOH backends

### B. Keep harness BYOH explicit
Continue treating local Claude Code CLI execution as its own backend family through the existing execution adapter seam.

This should not be folded into the hosted API backend.

## Anti-goals

Do not:
- collapse hosted API execution and harness BYOH into one blurry backend
- adopt pi-ai just to avoid direct OpenRouter implementation work
- let hosted API backend choices redefine Agent Assistant runtime semantics
- move Relay-native collaboration responsibilities into the execution layer

## Outcome

The next implementation wave should proceed with:
- **direct OpenRouter/API execution backend work**
- **separate harness BYOH backend work**
- **no pi-ai adoption in the immediate execution path**
