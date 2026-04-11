import type {
  AssistantTraits,
  SurfaceFormattingTraits,
  TraitsField,
  TraitsProvider,
} from './types.js';

const KNOWN_VOICES = new Set(['concise', 'conversational', 'formal', 'technical']);
const KNOWN_FORMALITY = new Set(['casual', 'professional', 'academic']);
const KNOWN_PROACTIVITY = new Set(['low', 'medium', 'high']);
const KNOWN_RISK_POSTURES = new Set(['cautious', 'moderate', 'assertive']);

export class TraitsValidationError extends Error {
  readonly field: TraitsField;
  readonly invalidValue: unknown;

  constructor(field: TraitsField, invalidValue: unknown, message: string) {
    super(message);
    this.name = 'TraitsValidationError';
    this.field = field;
    this.invalidValue = invalidValue;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertKnownStringValue(
  field: TraitsField,
  value: unknown,
  allowedValues: Set<string>,
): asserts value is string {
  if (!isNonEmptyString(value) || !allowedValues.has(value)) {
    throw new TraitsValidationError(
      field,
      value,
      `${field} must be one of: ${Array.from(allowedValues).map((entry) => `'${entry}'`).join(', ')}; got ${JSON.stringify(value)}`,
    );
  }
}

function validateAssistantTraits(traits: AssistantTraits): void {
  if (!isNonEmptyString(traits.voice)) {
    throw new TraitsValidationError('voice', traits.voice, 'voice must be a non-empty string');
  }

  if (!KNOWN_VOICES.has(traits.voice)) {
    console.warn(
      `Unknown assistant trait voice '${traits.voice}' accepted. Known values: ${Array.from(KNOWN_VOICES).join(', ')}`,
    );
  }

  assertKnownStringValue('formality', traits.formality, KNOWN_FORMALITY);
  assertKnownStringValue('proactivity', traits.proactivity, KNOWN_PROACTIVITY);
  assertKnownStringValue('riskPosture', traits.riskPosture, KNOWN_RISK_POSTURES);

  if (traits.domain !== undefined && !isNonEmptyString(traits.domain)) {
    throw new TraitsValidationError('domain', traits.domain, 'domain must be a non-empty string when provided');
  }

  if (traits.vocabulary !== undefined) {
    if (!Array.isArray(traits.vocabulary) || traits.vocabulary.length === 0) {
      throw new TraitsValidationError(
        'vocabulary',
        traits.vocabulary,
        'vocabulary must be a non-empty array of non-empty strings when provided',
      );
    }

    const hasInvalidEntry = traits.vocabulary.some((entry) => !isNonEmptyString(entry));
    if (hasInvalidEntry) {
      throw new TraitsValidationError(
        'vocabulary',
        traits.vocabulary,
        'vocabulary must contain only non-empty strings',
      );
    }
  }
}

function validateSurfaceFormattingTraits(surfaceFormatting: SurfaceFormattingTraits): void {
  if (
    surfaceFormatting.preferredResponseLength !== undefined
    && (
      !Number.isInteger(surfaceFormatting.preferredResponseLength)
      || surfaceFormatting.preferredResponseLength <= 0
    )
  ) {
    throw new TraitsValidationError(
      'preferredResponseLength',
      surfaceFormatting.preferredResponseLength,
      'preferredResponseLength must be a positive integer when provided',
    );
  }

  if (
    surfaceFormatting.preferRichBlocks !== undefined
    && typeof surfaceFormatting.preferRichBlocks !== 'boolean'
  ) {
    throw new TraitsValidationError(
      'preferRichBlocks',
      surfaceFormatting.preferRichBlocks,
      'preferRichBlocks must be a boolean when provided',
    );
  }

  if (
    surfaceFormatting.preferMarkdown !== undefined
    && typeof surfaceFormatting.preferMarkdown !== 'boolean'
  ) {
    throw new TraitsValidationError(
      'preferMarkdown',
      surfaceFormatting.preferMarkdown,
      'preferMarkdown must be a boolean when provided',
    );
  }
}

function freezeTraits(traits: AssistantTraits): Readonly<AssistantTraits> {
  const vocabulary = traits.vocabulary === undefined ? undefined : [...traits.vocabulary];
  if (vocabulary !== undefined) {
    Object.freeze(vocabulary);
  }

  return Object.freeze({
    ...traits,
    ...(vocabulary === undefined ? {} : { vocabulary }),
  }) as Readonly<AssistantTraits>;
}

function freezeSurfaceFormatting(
  surfaceFormatting: SurfaceFormattingTraits,
): Readonly<SurfaceFormattingTraits> {
  return Object.freeze({ ...surfaceFormatting });
}

export function createTraitsProvider(
  traits: AssistantTraits,
  surfaceFormatting?: SurfaceFormattingTraits,
): TraitsProvider {
  validateAssistantTraits(traits);

  if (surfaceFormatting !== undefined) {
    validateSurfaceFormattingTraits(surfaceFormatting);
  }

  const provider: TraitsProvider = {
    traits: freezeTraits(traits),
    ...(surfaceFormatting === undefined
      ? {}
      : { surfaceFormatting: freezeSurfaceFormatting(surfaceFormatting) }),
  };

  return Object.freeze(provider);
}
