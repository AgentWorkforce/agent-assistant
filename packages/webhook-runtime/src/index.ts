export { WebhookRegistry, createWebhookRegistry } from "./webhook-registry.js";

export { parseSlackEvent } from "./slack-parser.js";
export {
  SlackEventDedupGate,
  getSlackDeduplicationKey,
} from "@agent-assistant/surfaces";
export type {
  SlackEventDedupDecision,
  SlackEventDedupDropReason,
  SlackEventDedupGateOptions,
  SlackEventDedupInput,
  SlackEventDedupStore,
} from "@agent-assistant/surfaces";
export { registerSlackSpecialistConsumer } from "./specialist-bridge.js";
export type {
  RegisterSlackSpecialistConsumerOptions,
  RunnableSlackSpecialist,
  SlackSpecialistConsumerRegistry,
  SlackSpecialistEgress,
  SlackSpecialistEgressInput,
  SlackSpecialistFactory,
  SlackSpecialistFactoryInput,
  SlackSpecialistKind,
} from "./specialist-bridge.js";

// TODO: Implement the Hono HTTP runtime in a later step.
export { startHttpRuntime } from "./http-runtime.js";

export type * from "./types.js";
