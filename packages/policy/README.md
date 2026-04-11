# `@relay-assistant/policy`

Status: placeholder package README, no implementation yet.

## Purpose

This package is intended to define action policy and governance contracts for assistants.

Consumers should expect this package to own:

- approval modes
- external-action safeguards
- risk classification
- audit hooks

## Expected Consumer Role

A product should import this package when the assistant can perform or propose actions that require governance.

Illustrative usage target:

```ts
import { createActionPolicy } from "@relay-assistant/policy";
```

## What Stays Outside

- product pricing or tier rules
- customer-specific escalation policy
- hosted audit pipelines
