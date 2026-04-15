# @agent-assistant/inbox

Bounded v1 inbox primitives for trusted external inputs not already on Relay.

This package intentionally stays narrow:

- defines the normalized `InboxItem` shape and trust metadata
- provides an adapter-backed `InboxStore`
- projects inbox items into existing turn-context candidate types

This package intentionally excludes:

- Relay-native agent communication
- universal ingestion adapters
- UI, orchestration, or platform provisioning
- continuation or proactive wake behavior
