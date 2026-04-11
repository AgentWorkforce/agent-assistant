# `@relay-assistant/proactive`

Status: placeholder package README, no implementation yet.

## Purpose

This package is intended to define shared proactive behavior for assistants.

Consumers should expect this package to own:

- follow-up engines
- watcher contracts
- reminder policies
- scheduler bindings over Relay substrate

## Expected Consumer Role

A product should import this package when the assistant must act outside of direct user messages.

Illustrative usage target:

```ts
import { createProactiveEngine } from "@relay-assistant/proactive";
```

## What Stays Outside

- domain-specific watcher rules
- product-specific thresholds and alert semantics
- scheduler infrastructure itself
