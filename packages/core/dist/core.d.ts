import type { AssistantDefinition, AssistantRuntime, RelayInboundAdapter, RelayOutboundAdapter } from './types.js';
export declare class AssistantDefinitionError extends Error {
    constructor(message: string);
}
export declare class OutboundEventError extends Error {
    constructor(message: string);
}
export declare function createAssistant(definition: AssistantDefinition, adapters: {
    inbound: RelayInboundAdapter;
    outbound: RelayOutboundAdapter;
}): AssistantRuntime;
