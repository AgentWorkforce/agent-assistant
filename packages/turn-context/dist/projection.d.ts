import type { HarnessInstructions, HarnessPreparedContext } from '@agent-assistant/harness';
import type { TurnContextAssembly, TurnInstructionBundle, TurnPreparedContext, TurnShapingInput } from './types.js';
export interface ProjectedExecutionToolDescriptor {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    requiresApproval?: boolean;
    metadata?: Record<string, unknown>;
}
export interface ProjectedExecutionRequirements {
    toolUse?: 'forbidden' | 'allowed' | 'required';
    structuredToolCalls?: 'forbidden' | 'preferred' | 'required';
    continuationSupport?: 'none' | 'preferred' | 'required';
    approvalInterrupts?: 'none' | 'preferred' | 'required';
    traceDepth?: 'minimal' | 'standard' | 'detailed';
    attachments?: 'forbidden' | 'allowed' | 'required';
}
export interface ProjectedExecutionRequest {
    assistantId: string;
    turnId: string;
    sessionId?: string;
    userId?: string;
    threadId?: string;
    message: {
        id: string;
        text: string;
        receivedAt: string;
        attachments?: Array<{
            id: string;
            type: string;
            name?: string;
            url?: string;
            metadata?: Record<string, unknown>;
        }>;
    };
    instructions: {
        systemPrompt: string;
        developerPrompt?: string;
        responseStyle?: {
            preferMarkdown?: boolean;
            maxAnswerChars?: number;
        };
    };
    context?: {
        blocks: Array<{
            id: string;
            label: string;
            text: string;
            category?: 'memory' | 'workspace' | 'enrichment' | 'guardrail' | 'other';
            metadata?: Record<string, unknown>;
        }>;
        structured?: Record<string, unknown>;
    };
    continuation?: {
        continuationId?: string;
        kind?: 'clarification' | 'approval' | 'deferred' | string;
        state?: Record<string, unknown>;
        metadata?: Record<string, unknown>;
    };
    tools?: ProjectedExecutionToolDescriptor[];
    requirements?: ProjectedExecutionRequirements;
    metadata?: Record<string, unknown>;
}
/**
 * Projects the internal turn assembly into HarnessInstructions + HarnessPreparedContext.
 *
 * Projection rules:
 * - systemSegments concatenated (sorted high->low priority) -> HarnessInstructions.systemPrompt
 * - developerSegments + guardrailSegments concatenated -> HarnessInstructions.developerPrompt
 * - TurnPreparedContextBlock[] maps 1:1 to HarnessContextBlock[] (shape-compatible)
 * - responseStyle passed through when present
 */
export declare function projectToHarness(instructions: TurnInstructionBundle, context: TurnPreparedContext, responseStyle: TurnShapingInput['responseStyle'] | undefined): {
    instructions: HarnessInstructions;
    context: HarnessPreparedContext;
};
export type ExecutionRequestMessageInput = ProjectedExecutionRequest['message'];
export interface ToExecutionRequestOverrides {
    tools?: ProjectedExecutionToolDescriptor[];
    requirements?: ProjectedExecutionRequirements;
    continuation?: ProjectedExecutionRequest['continuation'];
    metadata?: Record<string, unknown>;
}
export declare function toExecutionRequest(assembly: TurnContextAssembly, userMessage: ExecutionRequestMessageInput, overrides?: ToExecutionRequestOverrides): ProjectedExecutionRequest;
