# @agent-assistant/cloudflare-runtime

Cloudflare-specific runtime adapters for Agent Assistant persona workers.

This package will host the ingress wrapper, queue executor, continuation
adapters, signature verification helpers, and Durable Object base classes used
by Sage, Specialist, and future personas. It is ESM-only and intentionally keeps
Cloudflare Worker types as development-only type dependencies.

The initial scaffold exposes shared binding and queue message types. Downstream
workflow steps will add the runtime implementation modules described in
`SPEC.md`.
