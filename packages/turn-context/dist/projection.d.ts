import type { HarnessInstructions, HarnessPreparedContext } from '@agent-assistant/harness';
import type { TurnInstructionBundle, TurnPreparedContext, TurnShapingInput } from './types.js';
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
