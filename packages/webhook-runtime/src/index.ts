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
export {
  buildAgentAssistantA2aCard,
  registerA2aRoutes,
} from "./a2a-runtime.js";
export type {
  A2aSkillDispatcher,
  A2aSkillDispatchInput,
  A2aSkillDispatchResult,
  AgentAssistantA2aSkill,
  BuildAgentAssistantA2aCardOptions,
  RegisterA2aRoutesOptions,
} from "./a2a-runtime.js";

// TODO: Implement the Hono HTTP runtime in a later step.
export { startHttpRuntime } from "./http-runtime.js";

export type * from "./types.js";
