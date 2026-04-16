import type {
  IngressHandler,
  IngressHandlerResult,
  IngressRouter,
} from './ingress-types.js';

function matchesHandler(
  handler: IngressHandler,
  provider: string,
  eventType: string,
): boolean {
  if (handler.provider !== provider) {
    return false;
  }

  if (!handler.eventTypes) {
    return true;
  }

  return handler.eventTypes.includes(eventType);
}

export function createIngressRouter(): IngressRouter {
  const handlers: IngressHandler[] = [];

  return {
    register(handler) {
      handlers.push(handler);
    },
    async route({ envelope, resolution }): Promise<IngressHandlerResult> {
      const handler = handlers.find((candidate) =>
        matchesHandler(candidate, envelope.provider, envelope.eventType),
      );

      if (!handler) {
        return {
          handled: false,
          outcome: 'skipped',
        };
      }

      try {
        return await handler.handle({ envelope, resolution });
      } catch (error) {
        return {
          handled: false,
          outcome: 'error',
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
