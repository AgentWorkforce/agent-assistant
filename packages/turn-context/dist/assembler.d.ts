import type { TurnContextAssembler, TurnMemoryRetriever } from './types.js';
export interface CreateTurnContextAssemblerOptions {
    memoryRetriever?: TurnMemoryRetriever;
}
export declare function createTurnContextAssembler(options?: CreateTurnContextAssemblerOptions): TurnContextAssembler;
