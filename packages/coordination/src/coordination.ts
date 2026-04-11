import { nanoid } from 'nanoid';

import type { ConnectivitySignal, SignalCallback } from '@relay-assistant/connectivity';

import {
  CoordinationBlockedError,
  CoordinationError,
  DelegationPlanError,
  SpecialistConflictError,
  SpecialistNotFoundError,
  SynthesisError,
} from './types.js';
import type {
  CoordinationSignals,
  CoordinationTurn,
  Coordinator,
  CoordinatorConfig,
  DelegationPlan,
  DelegationPlanValidation,
  Specialist,
  SpecialistRegistry,
  SpecialistResult,
  Synthesizer,
  SynthesisConfig,
  SynthesisOutput,
} from './types.js';

const DEFAULT_MAX_STEPS = 10;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && isNonEmptyString(error.message)) {
    return error.message;
  }

  return 'Unknown specialist execution failure';
}

function clonePlan(plan: DelegationPlan): DelegationPlan {
  return {
    intent: plan.intent,
    steps: plan.steps.map((step) => ({ ...step })),
  };
}

function cloneResult(result: SpecialistResult): SpecialistResult {
  return {
    specialistName: result.specialistName,
    output: result.output,
    status: result.status,
    ...(result.confidence === undefined ? {} : { confidence: result.confidence }),
    ...(result.metadata === undefined ? {} : { metadata: { ...result.metadata } }),
  };
}

function ensureConfidence(confidence: number | undefined): number | undefined {
  if (confidence === undefined) {
    return undefined;
  }

  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new CoordinationError('Specialist result confidence must be between 0.0 and 1.0');
  }

  return confidence;
}

function normalizeSpecialistResult(
  specialistName: string,
  result: SpecialistResult,
): SpecialistResult {
  if (!isNonEmptyString(result.output) && result.status !== 'failed') {
    throw new CoordinationError(
      `Specialist ${specialistName} returned an empty output for a non-failed result`,
    );
  }

  const confidence = ensureConfidence(result.confidence);

  return {
    specialistName,
    output: result.output,
    status: result.status,
    ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
    ...(confidence === undefined ? {} : { confidence }),
  };
}

function extractResultCost(result: SpecialistResult): number | null {
  const cost = result.metadata?.cost;
  const normalizedCost =
    typeof cost === 'number' ? cost : typeof cost === 'string' ? Number(cost) : Number.NaN;

  if (!Number.isFinite(normalizedCost) || normalizedCost <= 0) {
    return null;
  }

  return normalizedCost;
}

function collectSignals(
  observedSignals: ConnectivitySignal[],
  threadId: string,
): CoordinationSignals {
  const relevant = observedSignals.filter((signal) => signal.threadId === threadId);
  const handoffs = relevant.filter((signal) => signal.messageClass === 'handoff');
  const escalations = relevant.filter((signal) => signal.messageClass === 'escalation');
  const unresolvedConflicts = relevant.filter(
    (signal) => signal.signalClass === 'conflict.active' && signal.state !== 'superseded',
  );

  return {
    observed: relevant,
    handoffs,
    escalations,
    unresolvedConflicts,
  };
}

function resolveSignals(
  coordinatorConfig: CoordinatorConfig,
  signals: ConnectivitySignal[],
): void {
  for (const signal of signals) {
    if (signal.state === 'resolved' || signal.state === 'superseded' || signal.state === 'expired') {
      continue;
    }

    if (signal.signalClass === 'conflict.active') {
      continue;
    }

    coordinatorConfig.connectivity.resolve(signal.id);
  }
}

export function createSpecialistRegistry(): SpecialistRegistry {
  const specialists = new Map<string, Specialist>();

  return {
    register(specialist) {
      if (!isNonEmptyString(specialist.name)) {
        throw new CoordinationError('Specialist name must be a non-empty string');
      }

      if (specialists.has(specialist.name)) {
        throw new SpecialistConflictError(specialist.name);
      }

      specialists.set(specialist.name, specialist);
    },

    unregister(name) {
      specialists.delete(name);
    },

    get(name) {
      return specialists.get(name) ?? null;
    },

    list() {
      return [...specialists.values()];
    },

    has(name) {
      return specialists.has(name);
    },
  };
}

export function validateDelegationPlan(
  plan: DelegationPlan,
  registry: SpecialistRegistry,
  maxSteps = DEFAULT_MAX_STEPS,
): DelegationPlanValidation {
  const errors: string[] = [];

  if (!isNonEmptyString(plan.intent)) {
    errors.push('plan.intent must be a non-empty string');
  }

  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    errors.push('plan.steps must contain at least one step');
  }

  if (plan.steps.length > maxSteps) {
    errors.push(`plan.steps exceeds maxSteps (${maxSteps})`);
  }

  for (const [index, step] of plan.steps.entries()) {
    if (!isNonEmptyString(step.specialistName)) {
      errors.push(`plan.steps[${index}].specialistName must be a non-empty string`);
      continue;
    }

    if (!registry.has(step.specialistName)) {
      errors.push(`plan.steps[${index}] references unknown specialist ${step.specialistName}`);
    }

    if (!isNonEmptyString(step.instruction)) {
      errors.push(`plan.steps[${index}].instruction must be a non-empty string`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Creates a validated delegation plan. Throws DelegationPlanError if any step
 * references an unknown specialist or if the plan structure is invalid.
 *
 * To construct a plan without validation (for example, before registry
 * population), use the DelegationPlan interface directly and validate later
 * with validateDelegationPlan().
 */
export function createDelegationPlan(
  plan: DelegationPlan,
  registry: SpecialistRegistry,
  maxSteps = DEFAULT_MAX_STEPS,
): DelegationPlan {
  const validation = validateDelegationPlan(plan, registry, maxSteps);

  if (!validation.valid) {
    throw new DelegationPlanError(validation.errors.join('; '));
  }

  return clonePlan(plan);
}

export function createSynthesizer(config: SynthesisConfig): Synthesizer {
  return {
    synthesize(results, plan) {
      const usableResults = results.filter((result) => result.status !== 'failed');

      if (config.strategy === 'custom') {
        if (!config.customFn) {
          throw new SynthesisError('customFn is required when strategy is custom');
        }

        return config.customFn(usableResults.map(cloneResult), clonePlan(plan));
      }

      if (usableResults.length === 0) {
        return {
          text: '',
          contributingSpecialists: [],
          quality: 'degraded',
        };
      }

      const contributingSpecialists = usableResults.map((result) => result.specialistName);
      const quality =
        usableResults.length === plan.steps.length &&
        usableResults.every((result) => result.status === 'complete')
          ? 'complete'
          : 'degraded';

      if (config.strategy === 'last-wins') {
        const lastResult = usableResults[usableResults.length - 1];
        if (!lastResult) {
          throw new SynthesisError('last-wins synthesis requires at least one result');
        }

        return {
          text: lastResult.output,
          contributingSpecialists,
          quality,
        };
      }

      return {
        text: usableResults.map((result) => result.output).join('\n\n'),
        contributingSpecialists,
        quality,
      };
    },
  };
}

export function createCoordinator(config: CoordinatorConfig): Coordinator {
  const maxSteps = config.maxSteps ?? DEFAULT_MAX_STEPS;

  if (!Number.isInteger(maxSteps) || maxSteps <= 0) {
    throw new CoordinationError('maxSteps must be a positive integer');
  }

  const synthesizer = createSynthesizer(config.synthesis);

  return {
    async execute(plan): Promise<CoordinationTurn> {
      const normalizedPlan = createDelegationPlan(plan, config.registry, maxSteps);
      const turnId = `coord_${nanoid()}`;
      const threadId = turnId;
      const results: SpecialistResult[] = [];
      const skippedSteps: DelegationPlan['steps'] = [];
      const observedSignals: ConnectivitySignal[] = [];
      const routingDecisions: CoordinationTurn['routingDecisions'] = config.router ? [] : undefined;

      const callback: SignalCallback = (signal) => {
        if (signal.threadId === threadId) {
          observedSignals.push(signal);
        }
      };

      config.connectivity.registerSelectedResolver((signal) => {
        return normalizedPlan.steps
          .map((step) => step.specialistName)
          .filter((name) => name !== signal.source);
      });

      config.connectivity.onSignal(callback);

      try {
        for (const [stepIndex, step] of normalizedPlan.steps.entries()) {
          const specialist = config.registry.get(step.specialistName);
          if (!specialist) {
            throw new SpecialistNotFoundError(step.specialistName);
          }

          const routingDecision = config.router
            ? (() => {
                const decision = config.router.decide({
                  threadId,
                  capability: step.specialistName,
                  accumulatedCost: config.router.getAccumulatedCost(threadId),
                });

                routingDecisions?.push({
                  stepIndex,
                  specialistName: step.specialistName,
                  mode: decision.mode,
                  reason: decision.reason,
                });

                return {
                  mode: decision.mode,
                  tier: decision.modelSpec.tier,
                  hints: { ...decision.modelSpec.hints },
                  reason: decision.reason,
                  escalated: decision.escalated,
                  overridden: decision.overridden,
                };
              })()
            : undefined;

          try {
            const rawResult = await specialist.handler.execute(step.instruction, {
              turnId,
              threadId,
              stepIndex,
              plan: normalizedPlan,
              priorResults: results.map(cloneResult),
              connectivity: config.connectivity,
              ...(routingDecision === undefined ? {} : { routingDecision }),
            });
            const result = normalizeSpecialistResult(specialist.name, rawResult);
            results.push(result);

            const cost = extractResultCost(result);
            if (config.router && cost !== null) {
              config.router.recordCost(threadId, cost);
            }
          } catch (error) {
            const failure: SpecialistResult = {
              specialistName: specialist.name,
              output: normalizeErrorMessage(error),
              status: 'failed',
            };
            results.push(failure);

            if (step.optional) {
              skippedSteps.push({ ...step });
            } else {
              throw new CoordinationError(
                `Specialist ${specialist.name} failed: ${failure.output}`,
              );
            }
          }

          const activeSignals = config.connectivity.query({
            threadId,
            source: specialist.name,
            state: ['emitted', 'active'],
          });

          const blocker = activeSignals.find((signal) => signal.signalClass === 'confidence.blocker');
          if (blocker) {
            resolveSignals(config, [blocker]);
            if (step.optional) {
              skippedSteps.push({ ...step });
              config.connectivity.advanceStep(threadId);
              continue;
            }

            throw new CoordinationBlockedError(
              `Specialist ${specialist.name} reported a blocker: ${blocker.summary}`,
            );
          }

          const interrupt = activeSignals.find(
            (signal) => signal.signalClass === 'escalation.interrupt',
          );
          if (interrupt) {
            resolveSignals(config, [interrupt]);
            throw new CoordinationBlockedError(
              `Coordination interrupted by ${specialist.name}: ${interrupt.summary}`,
            );
          }

          config.connectivity.advanceStep(threadId);
        }

        const output = synthesizer.synthesize(results, normalizedPlan);
        const allSignals = config.connectivity.query({
          threadId,
          state: ['emitted', 'active', 'resolved', 'superseded'],
          order: 'oldest',
          limit: 500,
        });

        resolveSignals(config, allSignals);

        const signals = collectSignals(
          config.connectivity.query({
            threadId,
            state: ['emitted', 'active', 'resolved', 'superseded', 'expired'],
            order: 'oldest',
            limit: 500,
          }),
          threadId,
        );

        const effectiveOutput: SynthesisOutput =
          signals.unresolvedConflicts.length > 0 && output.quality === 'complete'
            ? { ...output, quality: 'degraded' }
            : output;

        return {
          turnId,
          threadId,
          plan: normalizedPlan,
          results,
          output: effectiveOutput,
          skippedSteps,
          signals,
          ...(routingDecisions === undefined ? {} : { routingDecisions }),
        };
      } finally {
        config.connectivity.offSignal(callback);
      }
    },
  };
}
