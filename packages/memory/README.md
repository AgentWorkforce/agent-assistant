# `@relay-assistant/memory`

Status: placeholder package README, no implementation yet.

## Purpose

This package is intended to define reusable assistant memory contracts.

Consumers should expect this package to own:

- memory scopes such as user, session, workspace, org, and object
- retrieval and persistence contracts
- promotion and compaction hooks
- adapter boundaries for future memory backends

## Expected Consumer Role

A product should import this package when assistant continuity depends on durable or structured memory.

Illustrative usage target:

```ts
import { createMemoryStore } from "@relay-assistant/memory";
```

## What Stays Outside

- product-specific tags and memory heuristics
- prompt assembly logic unique to one product
- private hosted memory implementations
