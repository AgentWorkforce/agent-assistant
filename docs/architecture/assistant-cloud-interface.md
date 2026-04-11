# Assistant Cloud Interface

Date: 2026-04-11

## Purpose

Define the interface between the RelayAssistant SDK and the hosted infrastructure layer implemented in `AgentWorkforce/cloud`.

## Product line

RelayAssistant is the assistant SDK for building persistent, proactive, multi-agent assistants on top of Agent Relay. Developers define the assistant on their side, connect with an API key, and use AgentWorkforce infrastructure and primitives to make it work.

## Boundary

### Local / SDK side

Developers own:
- assistant definition
- package composition
- traits/persona configuration
- local adapters and product-specific logic
- optional self-hosted/local runtime paths

### Hosted / infrastructure side

The existing `AgentWorkforce/cloud` repo should own hosted capabilities such as:
- API key issuance and validation
- assistant registration / organization environment model
- managed session and state backing services where applicable
- managed memory backends where applicable
- proactive job infrastructure / scheduler bindings where applicable
- hosted observability / audit / dashboards
- cloud adapters and deployment-specific runtime glue

## Interface concepts

A future formal contract should cover:
- assistant registration payload
- API key / environment binding
- capabilities declaration
- hosted primitive enablement (sessions, memory, proactive, etc.)
- local-vs-hosted responsibility boundaries
- version negotiation between SDK and hosted control plane

## Guiding rule

The SDK defines the assistant-facing interfaces. The cloud repo implements hosted infrastructure behind those interfaces.

## Non-goal

Do not treat hosted infrastructure as a separate conceptual product line for naming purposes. The project is **RelayAssistant**; hosted infrastructure lives in the existing `AgentWorkforce/cloud` repo.
