import type { Coordinator, CoordinatorConfig, DelegationPlan, DelegationPlanValidation, SpecialistRegistry, Synthesizer, SynthesisConfig } from './types.js';
export declare function createSpecialistRegistry(): SpecialistRegistry;
export declare function validateDelegationPlan(plan: DelegationPlan, registry: SpecialistRegistry, maxSteps?: number): DelegationPlanValidation;
/**
 * Creates a validated delegation plan. Throws DelegationPlanError if any step
 * references an unknown specialist or if the plan structure is invalid.
 *
 * To construct a plan without validation (for example, before registry
 * population), use the DelegationPlan interface directly and validate later
 * with validateDelegationPlan().
 */
export declare function createDelegationPlan(plan: DelegationPlan, registry: SpecialistRegistry, maxSteps?: number): DelegationPlan;
export declare function createSynthesizer(config: SynthesisConfig): Synthesizer;
export declare function createCoordinator(config: CoordinatorConfig): Coordinator;
//# sourceMappingURL=coordination.d.ts.map