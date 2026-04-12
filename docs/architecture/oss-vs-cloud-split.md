# OSS vs Cloud Split

Date: 2026-04-11

## Purpose

This document defines the intended split between:

- the open-source assistant SDK in this repo
- a future cloud implementation built on top of it

The split should remain explicit from the start so the OSS package boundaries do not become polluted with hosted infrastructure concerns.

## OSS SDK: what belongs here

This repository should contain the reusable assistant core:

- assistant runtime contracts
- package-level abstractions for memory, sessions, surfaces, proactive behavior, coordination, and policy
- local or self-hosted friendly interfaces
- reference examples and adoption docs

The OSS SDK should be usable without any hosted service from AgentWorkforce.

That means:

- no mandatory cloud control plane
- no required proprietary storage backend
- no hosted-only auth assumption in core package contracts
- no Cloudflare-specific runtime assumptions in public interfaces

## Future cloud layer: what belongs elsewhere

A later cloud implementation should live in a separate package or repo and depend on the OSS SDK.

That later cloud layer can provide:

- hosted assistant control plane
- managed memory backends
- cloud scheduler adapters
- multi-tenant provisioning
- Cloudflare-backed delivery, state, cache, or workflow adapters
- product operations dashboards and hosted observability

Possible future naming pattern:

- OSS here: `@agent-assistant/*`
- cloud elsewhere: `@agent-assistant-cloud/*` or a separate cloud repo

The exact package names can be decided later. The boundary should not.

## Dependency Direction

The dependency rule is strict:

- cloud packages may depend on OSS packages
- OSS packages must not depend on cloud packages

This keeps the SDK reusable and open-source-friendly.

## Consumer Guidance

Product teams should build against the OSS interfaces first.

Examples:

- Sage should be able to compose `@agent-assistant/*` packages using its current local or product-owned backends
- MSD should be able to use the session and surface contracts without any hosted runtime assumption
- NightCTO should be able to adopt coordination and policy contracts before any shared cloud control plane exists

If a hosted implementation appears later, products can swap in cloud adapters without changing their assistant architecture.

## Boundary Examples

### OSS examples

- `MemoryStore` interface
- `AssistantSession` contract
- `ProactiveEngine` interface
- `Coordinator` contract
- `ActionPolicy` interface

### Cloud examples

- managed memory adapter backed by hosted storage
- cloud scheduler binding over a managed workflow system
- hosted tenant provisioning and lifecycle services
- managed audit/event pipeline
- hosted dashboard and operational APIs

## Design Constraint

When defining an OSS package API, ask:

- can a self-hosted or local consumer implement this without any private service

If the answer is no, the abstraction is too cloud-specific for this repo.

## Recommended Future Structure

Short term:

- keep this repo docs-first and OSS-only
- keep all cloud discussion architectural, not operational

Later:

- create a separate cloud adapter layer once OSS interfaces stabilize
- implement cloud packages as adapters over the OSS contracts rather than extending product repos directly

## Why This Matters

This split prevents two failure modes:

- an OSS repo that is nominally open source but functionally unusable without private infrastructure
- a cloud layer that bypasses the SDK and causes a second, incompatible assistant architecture

The intended model is:

- OSS SDK here
- optional hosted adapters later
- product repos built on the OSS SDK in both cases
