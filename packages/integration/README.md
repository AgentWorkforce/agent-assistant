# `@agent-assistant/integration-tests`

**Status:** private package for monorepo verification only.

`@agent-assistant/integration-tests` is the cross-package verification package for the Agent Assistant SDK monorepo.

It is not a consumer-facing runtime package and is not intended to be published as part of the public product surface.

## Purpose

This package exists to prove that adjacent runtime primitives compose cleanly across package boundaries.

It focuses on integration behavior such as:

- runtime assembly across baseline packages
- subsystem registration and retrieval
- package-boundary compatibility
- facade and direct-package coexistence where relevant
- cross-package assumptions that unit tests alone would miss

## What it is not

This package is not:

- a product runtime package
- a public SDK facade
- a substitute for real product proof in Sage / NightCTO / other consumers
- a documentation package for external adopters

## Development

From the repo root:

```bash
npx vitest run packages/integration/src/integration.test.ts
```

Or run the full repo suite:

```bash
npx vitest run
```

## Why it matters

Passing package-local tests are necessary but not sufficient. This package helps catch the seam failures that only appear when multiple runtime primitives are assembled together.
