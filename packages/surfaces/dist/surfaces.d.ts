import type { NormalizedInboundMessage, SurfaceOutboundEvent, SurfaceRegistry, SurfaceRegistryConfig } from './types.js';
type CoreInboundAdapterShape = {
    onMessage(handler: (message: NormalizedInboundMessage) => void): void;
    offMessage(handler: (message: NormalizedInboundMessage) => void): void;
};
type CoreOutboundAdapterShape = {
    send(event: SurfaceOutboundEvent): Promise<void>;
    fanout?(event: SurfaceOutboundEvent, attachedSurfaceIds: string[]): Promise<void>;
};
export declare function createSurfaceRegistry(config?: SurfaceRegistryConfig): SurfaceRegistry & CoreInboundAdapterShape & CoreOutboundAdapterShape;
export {};
