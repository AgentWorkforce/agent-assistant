export class SurfaceNotFoundError extends Error {
    surfaceId;
    constructor(surfaceId) {
        super(`Surface not found: ${surfaceId}`);
        this.surfaceId = surfaceId;
        this.name = 'SurfaceNotFoundError';
    }
}
export class SurfaceConflictError extends Error {
    surfaceId;
    constructor(surfaceId) {
        super(`Surface already registered: ${surfaceId}`);
        this.surfaceId = surfaceId;
        this.name = 'SurfaceConflictError';
    }
}
export class SurfaceDeliveryError extends Error {
    surfaceId;
    constructor(surfaceId, cause) {
        super(`Delivery failed for surface ${surfaceId}: ${cause.message}`);
        this.surfaceId = surfaceId;
        this.name = 'SurfaceDeliveryError';
        this.cause = cause;
    }
}
