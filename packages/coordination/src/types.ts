import type {
  ConnectivityLayer,
  ConnectivitySignal,
} from '@agent-assistant/connectivity';
import type { RequestedRoutingMode, RoutingMode } from '@agent-assistant/routing';

export type SpecialistExecutionStatus = 'complete' | 'partial' | 'failed';
export type SynthesisStrategy = 'concatenate' | 'last-wins' | 'custom';
export type SynthesisQuality = 'complete' | 'degraded';

export interface SpecialistDefinition {
  name: string;
  description: string;
  capabilities: string[];
}

export interface SpecialistResult {
  specialistName: string;
  output: string;
  confidence?: number;
  status: SpecialistExecutionStatus;
  metadata?: Record<string, unknown>;
}

export interface SpecialistContext {
  turnId: string;
  threadId: string;
  stepIndex: number;
  plan: DelegationPlan;
  priorResults: SpecialistResult[];
  connectivity: ConnectivityLayer;
  routingDecision?: {
    mode: RoutingMode;
    tier: string;
    hints: Record<string, unknown>;
    reason: string;
    escalated: boolean;
    overridden: boolean;
  };
}

export interface SpecialistHandler {
  execute(instruction: string, context: SpecialistContext): Promise<SpecialistResult>;
}

export interface Specialist extends SpecialistDefinition {
  handler: SpecialistHandler;
}

export interface SpecialistRegistry {
  register(specialist: Specialist): void;
  unregister(name: string): void;
  get(name: string): Specialist | null;
  list(): Specialist[];
  has(name: string): boolean;
}

export interface DelegationStep {
  specialistName: string;
  instruction: string;
  optional?: boolean;
}

export interface DelegationPlan {
  intent: string;
  steps: DelegationStep[];
}

export interface DelegationPlanValidation {
  valid: boolean;
  errors: string[];
}

export interface SynthesisOutput {
  text: string;
  contributingSpecialists: string[];
  quality: SynthesisQuality;
}

export interface SynthesisConfig {
  strategy: SynthesisStrategy;
  customFn?: (results: SpecialistResult[], plan: DelegationPlan) => SynthesisOutput;
}

export interface Synthesizer {
  synthesize(results: SpecialistResult[], plan: DelegationPlan): SynthesisOutput;
}

export interface CoordinationSignals {
  observed: ConnectivitySignal[];
  handoffs: ConnectivitySignal[];
  escalations: ConnectivitySignal[];
  unresolvedConflicts: ConnectivitySignal[];
}

export interface CoordinationTurn {
  turnId: string;
  threadId: string;
  plan: DelegationPlan;
  results: SpecialistResult[];
  output: SynthesisOutput;
  skippedSteps: DelegationStep[];
  signals: CoordinationSignals;
  routingDecisions?: Array<{
    stepIndex: number;
    specialistName: string;
    mode: RoutingMode;
    reason: string;
  }>;
}

export interface CoordinationRouter {
  decide(context: {
    threadId: string;
    capability: string;
    accumulatedCost?: number;
    requestedMode?: RequestedRoutingMode;
  }): {
    mode: RoutingMode;
    modelSpec: {
      tier: string;
      hints: Record<string, unknown>;
    };
    reason: string;
    escalated: boolean;
    overridden: boolean;
  };
  recordCost(threadId: string, cost: number): void;
  getAccumulatedCost(threadId: string): number;
}

export interface CoordinatorConfig {
  registry: SpecialistRegistry;
  connectivity: ConnectivityLayer;
  synthesis: SynthesisConfig;
  maxSteps?: number;
  router?: CoordinationRouter;
}

export interface Coordinator {
  execute(plan: DelegationPlan): Promise<CoordinationTurn>;
}

export class CoordinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoordinationError';
  }
}

export class SpecialistConflictError extends CoordinationError {
  constructor(name: string) {
    super(`Specialist already registered: ${name}`);
    this.name = 'SpecialistConflictError';
  }
}

export class SpecialistNotFoundError extends CoordinationError {
  constructor(name: string) {
    super(`Specialist not found: ${name}`);
    this.name = 'SpecialistNotFoundError';
  }
}

export class DelegationPlanError extends CoordinationError {
  constructor(message: string) {
    super(message);
    this.name = 'DelegationPlanError';
  }
}

export class SynthesisError extends CoordinationError {
  constructor(message: string) {
    super(message);
    this.name = 'SynthesisError';
  }
}

export class CoordinationBlockedError extends CoordinationError {
  constructor(message: string) {
    super(message);
    this.name = 'CoordinationBlockedError';
  }
}
