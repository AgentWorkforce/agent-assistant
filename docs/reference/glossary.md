# Glossary

Date: 2026-04-11

## Assistant

A user-facing coherent agent experience that may internally use multiple runtimes, specialists, and subsystems while appearing as one consistent entity to the user.

## Assistant session

The shared continuity unit for an assistant interaction. An assistant session may span multiple surfaces and should survive re-entry, reattachment, and background work.

## Surface

A user-facing interaction medium such as web, desktop, Slack, WhatsApp, Telegram, CLI, or voice.

## Surface attachment

A binding between a surface-specific thread/channel/window and an assistant session.

## Specialist

An internal agent or subsystem with a narrower responsibility than the primary assistant, such as memory synthesis, proactive watch, code review, or digest generation.

## Coordinator

The subsystem responsible for routing work among specialists, collecting outputs, resolving conflicts, and preserving one coherent assistant response.

## Connectivity

The focused inter-agent signaling layer used for efficient coordination between assistant subsystems and specialists. It is not generic chatter; it is structured signaling for convergence, attention, escalation, and synthesis.

## Relay foundation

The lower-level AgentWorkforce substrate that owns transport adapters, normalization, delivery, auth, scheduler substrate, relaycast/channels, and low-level action dispatch.

## Memory promotion

The process by which ephemeral conversational details are elevated into longer-lived durable memory.

## Compaction

The process of reducing prior context into a smaller representation that preserves useful meaning for future continuation.

## Affinity

A routing preference that keeps work, sessions, or surfaces attached to the runtime or environment most suitable for continuity, performance, or policy.

## Proactive engine

The subsystem that watches for triggers, scheduled conditions, stale states, or other evidence that the assistant should act without waiting for a new inbound message.

## Evidence

The signals used to justify proactive actions, escalations, summaries, or state transitions. Examples include stale threads, failed checks, watch hits, schedule triggers, or recent message patterns.

## OSS core

The open-source reusable SDK/runtime layer that defines assistant primitives without assuming hosted infrastructure.

## Cloud implementation

A hosted or infrastructure-backed layer that depends on the OSS core and provides cloud adapters, managed services, or platform-specific deployment/runtime features.
