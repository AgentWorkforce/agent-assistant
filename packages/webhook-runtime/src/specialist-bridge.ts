import type {
  NormalizedWebhook,
  WebhookConsumer,
  WebhookConsumerPredicate,
} from "./types.js";

export type SlackSpecialistKind = "github" | "linear" | (string & {});

export type SlackSpecialistFactoryInput = {
  consumerId: string;
  specialistKind: SlackSpecialistKind;
  event: NormalizedWebhook;
  instruction: string;
};

export type RunnableSlackSpecialist = {
  handler: {
    execute(instruction: string, context?: unknown): Promise<unknown>;
  };
};

export type SlackSpecialistFactory = (
  input: SlackSpecialistFactoryInput,
) => Promise<RunnableSlackSpecialist> | RunnableSlackSpecialist;

export type SlackSpecialistEgressInput = {
  consumerId: string;
  specialistKind: SlackSpecialistKind;
  event: NormalizedWebhook;
  response: unknown;
};

export type SlackSpecialistEgress = (
  input: SlackSpecialistEgressInput,
) => Promise<void> | void;

export type SlackSpecialistConsumerRegistry = {
  register(consumer: WebhookConsumer): void;
};

export type RegisterSlackSpecialistConsumerOptions = {
  id: string;
  specialistKind: SlackSpecialistKind;
  predicate?: WebhookConsumerPredicate;
  egress: SlackSpecialistEgress;
  specialistFactory?: SlackSpecialistFactory;
};

type SpecialistsModule = {
  createGitHubLibrarian?: (options: { vfs: EmptyVfs }) => RunnableSlackSpecialist;
  createLinearLibrarian?: (options: { vfs: EmptyVfs }) => RunnableSlackSpecialist;
};

type EmptyVfs = {
  list(path: string, options?: { depth?: number; limit?: number }): Promise<readonly []>;
  search(query: string, options?: { provider?: string; limit?: number }): Promise<readonly []>;
};

const emptyVfs: EmptyVfs = {
  async list() {
    return [];
  },
  async search() {
    return [];
  },
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function instructionForEvent(event: NormalizedWebhook): string {
  const text = readString(event.data?.text);
  if (text) {
    return text;
  }

  return JSON.stringify({
    eventType: event.eventType,
    workspaceId: event.workspaceId,
    payload: event.payload,
  });
}

async function defaultSpecialistFactory({
  specialistKind,
}: SlackSpecialistFactoryInput): Promise<RunnableSlackSpecialist> {
  const moduleName = "@agent-assistant/specialists";
  const specialists = (await import(moduleName)) as SpecialistsModule;

  if (specialistKind === "github" && specialists.createGitHubLibrarian) {
    return specialists.createGitHubLibrarian({ vfs: emptyVfs });
  }

  if (specialistKind === "linear" && specialists.createLinearLibrarian) {
    return specialists.createLinearLibrarian({ vfs: emptyVfs });
  }

  throw new Error(`Unsupported Slack specialist kind: ${specialistKind}`);
}

/**
 * Register an in-process Slack fanout consumer for local/BYOH deployments.
 *
 * cf-runtime personas should not use this bridge: enqueue a `specialist_call`
 * queue message and resume on `specialist_result:<turnId>` instead, so the
 * persona turn is awaited by the runtime rather than orphaned inside fanout.
 */
export function registerSlackSpecialistConsumer(
  registry: SlackSpecialistConsumerRegistry,
  opts: RegisterSlackSpecialistConsumerOptions,
): void {
  const consumer: WebhookConsumer = {
    id: opts.id,
    kind: "local",
    provider: "slack",
    predicate: opts.predicate,
    async handler(event) {
      const instruction = instructionForEvent(event);
      const factory = opts.specialistFactory ?? defaultSpecialistFactory;
      const specialist = await factory({
        consumerId: opts.id,
        specialistKind: opts.specialistKind,
        event,
        instruction,
      });
      const response = await specialist.handler.execute(instruction, {
        source: "webhook-runtime",
        consumerId: opts.id,
        specialistKind: opts.specialistKind,
        webhookEvent: event,
      });

      await opts.egress({
        consumerId: opts.id,
        specialistKind: opts.specialistKind,
        event,
        response,
      });
    },
  };

  registry.register(consumer);
}
