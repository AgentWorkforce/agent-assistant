import type {
  HarnessInstructions,
  HarnessPreparedContext,
} from '@agent-assistant/harness';
import type {
  TurnContextAssembly,
  TurnInstructionBundle,
  TurnInstructionSegment,
  TurnPreparedContextBlock,
  TurnPreparedContext,
  TurnShapingInput,
} from './types.js';

type Priority = 'low' | 'medium' | 'high';

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

export type ExecutionRequestMessageInput = ProjectedExecutionRequest['message'];

export interface ToExecutionRequestOverrides {
  tools?: ProjectedExecutionToolDescriptor[];
  requirements?: ProjectedExecutionRequirements;
  continuation?: ProjectedExecutionRequest['continuation'];
  metadata?: Record<string, unknown>;
}

function mapContextCategory(
  category: TurnPreparedContextBlock['category'],
): NonNullable<NonNullable<ProjectedExecutionRequest['context']>['blocks'][number]['category']> | undefined {
  if (category === 'session') {
    return 'other';
  }

  return category;
}

function mapContextBlock(
  block: TurnPreparedContextBlock,
): NonNullable<ProjectedExecutionRequest['context']>['blocks'][number] {
  const mappedCategory = mapContextCategory(block.category);

  return {
    id: block.id,
    label: block.label,
    text: block.content,
    ...(mappedCategory !== undefined ? { category: mappedCategory } : {}),
    ...(block.source !== undefined || block.importance !== undefined || block.category === 'session'
      ? {
          metadata: {
            ...(block.source !== undefined ? { source: block.source } : {}),
            ...(block.importance !== undefined ? { importance: block.importance } : {}),
            ...(block.category === 'session' ? { turnContextCategory: 'session' } : {}),
          },
        }
      : {}),
  };
}

function mergeMetadata(
  assemblyMetadata: Record<string, unknown> | undefined,
  overrideMetadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (assemblyMetadata === undefined && overrideMetadata === undefined) {
    return undefined;
  }

  return {
    ...(assemblyMetadata ?? {}),
    ...(overrideMetadata ?? {}),
  };
}

export function toExecutionRequest(
  assembly: TurnContextAssembly,
  userMessage: ExecutionRequestMessageInput,
  overrides: ToExecutionRequestOverrides = {},
): ProjectedExecutionRequest {
  const context: ProjectedExecutionRequest['context'] = {
    blocks: assembly.context.blocks.map(mapContextBlock),
    ...(assembly.context.structured !== undefined ? { structured: assembly.context.structured } : {}),
  };
  const metadata = mergeMetadata(assembly.metadata, overrides.metadata);

  return {
    assistantId: assembly.assistantId,
    turnId: assembly.turnId,
    ...(assembly.sessionId !== undefined ? { sessionId: assembly.sessionId } : {}),
    ...(assembly.userId !== undefined ? { userId: assembly.userId } : {}),
    ...(assembly.threadId !== undefined ? { threadId: assembly.threadId } : {}),
    message: userMessage,
    instructions: assembly.harnessProjection.instructions,
    context,
    ...(overrides.continuation !== undefined ? { continuation: overrides.continuation } : {}),
    ...(overrides.tools !== undefined ? { tools: overrides.tools } : {}),
    ...(overrides.requirements !== undefined ? { requirements: overrides.requirements } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}
