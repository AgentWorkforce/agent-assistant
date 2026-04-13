import type { HarnessInstructions, HarnessPreparedContext } from '@agent-assistant/harness';
import type {
  TurnInstructionBundle,
  TurnInstructionSegment,
  TurnPreparedContext,
  TurnShapingInput,
} from './types.js';

type Priority = 'low' | 'medium' | 'high';

const PRIORITY_ORDER: Record<Priority, number> = { low: 0, medium: 1, high: 2 };

function priorityOf(seg: TurnInstructionSegment): number {
  return PRIORITY_ORDER[seg.priority ?? 'medium'];
}

function sortByPriority(segments: TurnInstructionSegment[]): TurnInstructionSegment[] {
  return [...segments].sort((a, b) => priorityOf(b) - priorityOf(a));
}

function joinSegments(segments: TurnInstructionSegment[]): string {
  return sortByPriority(segments)
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join('\n\n');
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
export function projectToHarness(
  instructions: TurnInstructionBundle,
  context: TurnPreparedContext,
  responseStyle: TurnShapingInput['responseStyle'] | undefined,
): {
  instructions: HarnessInstructions;
  context: HarnessPreparedContext;
} {
  const systemPrompt = joinSegments(instructions.systemSegments);
  const developerParts = [
    ...sortByPriority(instructions.developerSegments),
    ...sortByPriority(instructions.guardrailSegments),
  ];
  const developerPrompt =
    developerParts.length > 0
      ? developerParts
          .map((s) => s.text.trim())
          .filter(Boolean)
          .join('\n\n')
      : undefined;

  const harnessInstructions: HarnessInstructions = {
    systemPrompt,
    ...(developerPrompt !== undefined ? { developerPrompt } : {}),
    ...(responseStyle !== undefined ? { responseStyle } : {}),
  };

  const harnessContext: HarnessPreparedContext = {
    blocks: context.blocks.map((block) => ({
      id: block.id,
      label: block.label,
      content: block.content,
      ...(block.importance !== undefined ? { importance: block.importance } : {}),
      ...(block.source !== undefined ? { source: block.source } : {}),
    })),
    ...(context.structured !== undefined ? { structured: context.structured } : {}),
  };

  return {
    instructions: harnessInstructions,
    context: harnessContext,
  };
}
