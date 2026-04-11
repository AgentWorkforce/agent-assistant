export type SurfaceType = 'web' | 'slack' | 'desktop' | 'api' | string;
export type SurfaceState = 'registered' | 'active' | 'inactive';
export interface SurfaceCapabilities {
    markdown: boolean;
    richBlocks: boolean;
    attachments: boolean;
    streaming: boolean;
    maxResponseLength: number;
}
export interface SurfaceOutboundEvent {
    surfaceId?: string;
    sessionId?: string;
    text: string;
    format?: unknown;
}
export interface NormalizedInboundMessage {
    id: string;
    surfaceId: string;
    sessionId?: string;
    userId: string;
    workspaceId?: string;
    text: string;
    raw: unknown;
    receivedAt: string;
    capability: string;
}
export interface SurfacePayload {
    event: SurfaceOutboundEvent;
    formatted: unknown;
    surfaceCapabilities: SurfaceCapabilities;
}
export interface SurfaceAdapter {
    send(payload: SurfacePayload): Promise<void>;
    onConnect(callback: () => void): void;
    onDisconnect(callback: () => void): void;
}
export type SurfaceFormatHook = (event: SurfaceOutboundEvent, capabilities: SurfaceCapabilities) => Promise<unknown> | unknown;
export interface SurfaceConnection {
    id: string;
    type: SurfaceType;
    state: SurfaceState;
    capabilities: SurfaceCapabilities;
    adapter: SurfaceAdapter;
    formatHook?: SurfaceFormatHook;
}
export interface FanoutPolicy {
    onError?: 'continue' | 'abort';
    skipInactive?: boolean;
}
export interface FanoutOutcome {
    surfaceId: string;
    status: 'delivered' | 'skipped' | 'failed';
    error?: Error;
}
export interface FanoutResult {
    total: number;
    delivered: number;
    outcomes: FanoutOutcome[];
}
export interface SurfaceRegistryConfig {
    defaultFanoutPolicy?: FanoutPolicy;
    normalizationHook?: (surfaceId: string, raw: unknown) => NormalizedInboundMessage | null | undefined;
}
export interface SurfaceRegistry {
    register(connection: SurfaceConnection): void;
    unregister(surfaceId: string): void;
    get(surfaceId: string): SurfaceConnection | null;
    list(filter?: {
        state?: SurfaceState;
        type?: SurfaceType;
    }): SurfaceConnection[];
    send(event: SurfaceOutboundEvent): Promise<void>;
    fanout(event: SurfaceOutboundEvent, attachedSurfaceIds: string[], policy?: FanoutPolicy): Promise<FanoutResult>;
    receiveRaw(surfaceId: string, raw: unknown): void;
    onMessage(handler: (message: NormalizedInboundMessage) => void): void;
    offMessage(handler: (message: NormalizedInboundMessage) => void): void;
}
export declare class SurfaceNotFoundError extends Error {
    readonly surfaceId: string;
    constructor(surfaceId: string);
}
export declare class SurfaceConflictError extends Error {
    readonly surfaceId: string;
    constructor(surfaceId: string);
}
export declare class SurfaceDeliveryError extends Error {
    readonly surfaceId: string;
    constructor(surfaceId: string, cause: Error);
}
