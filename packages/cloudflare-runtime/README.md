# @agent-assistant/cloudflare-runtime

Cloudflare-specific runtime adapters for Agent Assistant persona workers.

Hosts the ingress wrapper, queue executor, continuation adapters (DO storage +
KV trigger index), DO alarm scheduler, delivery adapter, signature
verification helpers, the abstract `TurnExecutorDO` base class, and structured
observability primitives used by Sage, Specialist, and future personas built
on `@agent-assistant/continuation`. ESM-only; Cloudflare Worker types are a
development-only type dependency.

See
[`docs/specs/v1-cloudflare-runtime-spec.md`](../../docs/specs/v1-cloudflare-runtime-spec.md)
for the package contract, invariants, persona two-function contract, queue
message shape, and observability surface.
