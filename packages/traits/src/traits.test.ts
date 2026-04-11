import { describe, expect, it, vi, afterEach } from 'vitest';

import { createTraitsProvider, TraitsValidationError } from './traits.js';
import type { AssistantTraits, SurfaceFormattingTraits, TraitsProvider } from './types.js';

const providerContract: TraitsProvider = createTraitsProvider({
  voice: 'concise',
  formality: 'professional',
  proactivity: 'medium',
  riskPosture: 'moderate',
});
void providerContract;

function createBaseTraits(overrides: Partial<AssistantTraits> = {}): AssistantTraits {
  return {
    voice: 'concise',
    formality: 'professional',
    proactivity: 'medium',
    riskPosture: 'moderate',
    ...overrides,
  };
}

function createSurfaceFormatting(
  overrides: Partial<SurfaceFormattingTraits> = {},
): SurfaceFormattingTraits {
  return {
    preferredResponseLength: 800,
    preferRichBlocks: false,
    preferMarkdown: true,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('traits package v1 workflows', () => {
  it('creates a provider with required fields only', () => {
    const provider = createTraitsProvider(createBaseTraits());

    expect(provider.traits.voice).toBe('concise');
    expect(provider.traits.formality).toBe('professional');
    expect(provider.surfaceFormatting).toBeUndefined();
  });

  it('creates a provider with all supported fields', () => {
    const provider = createTraitsProvider(
      createBaseTraits({
        domain: 'knowledge-and-workspace',
        vocabulary: ['digest', 'workspace', 'context'],
      }),
      createSurfaceFormatting(),
    );

    expect(provider.traits.domain).toBe('knowledge-and-workspace');
    expect(provider.traits.vocabulary).toEqual(['digest', 'workspace', 'context']);
    expect(provider.surfaceFormatting).toEqual({
      preferredResponseLength: 800,
      preferRichBlocks: false,
      preferMarkdown: true,
    });
  });

  it('accepts omitted surface formatting', () => {
    const provider = createTraitsProvider(createBaseTraits());

    expect(provider.surfaceFormatting).toBeUndefined();
  });

  it('accepts an empty surface formatting object', () => {
    const provider = createTraitsProvider(createBaseTraits(), {});

    expect(provider.surfaceFormatting).toEqual({});
  });

  it.each(['concise', 'conversational', 'formal', 'technical'] as const)(
    'accepts known voice value %s',
    (voice) => {
      const provider = createTraitsProvider(createBaseTraits({ voice }));
      expect(provider.traits.voice).toBe(voice);
    },
  );

  it('throws for invalid formality', () => {
    expect(() =>
      createTraitsProvider(createBaseTraits({ formality: 'semi-formal' })),
    ).toThrowError(TraitsValidationError);

    expect(() =>
      createTraitsProvider(createBaseTraits({ formality: 'semi-formal' })),
    ).toThrowError(/formality/);
  });

  it('throws for invalid proactivity', () => {
    expect(() =>
      createTraitsProvider(createBaseTraits({ proactivity: 'very-high' })),
    ).toThrowError(TraitsValidationError);
  });

  it('throws for invalid risk posture', () => {
    expect(() =>
      createTraitsProvider(createBaseTraits({ riskPosture: 'reckless' })),
    ).toThrowError(TraitsValidationError);
  });

  it('throws for an empty voice', () => {
    expect(() =>
      createTraitsProvider(createBaseTraits({ voice: '' })),
    ).toThrowError(TraitsValidationError);
  });

  it('throws for a whitespace-only voice', () => {
    expect(() =>
      createTraitsProvider(createBaseTraits({ voice: '   ' })),
    ).toThrowError(TraitsValidationError);
  });

  it('throws for an empty domain', () => {
    expect(() =>
      createTraitsProvider(createBaseTraits({ domain: '' })),
    ).toThrowError(TraitsValidationError);
  });

  it('throws for a whitespace-only domain', () => {
    expect(() =>
      createTraitsProvider(createBaseTraits({ domain: '   ' })),
    ).toThrowError(TraitsValidationError);
  });

  it('throws for an empty vocabulary array', () => {
    expect(() =>
      createTraitsProvider(createBaseTraits({ vocabulary: [] })),
    ).toThrowError(TraitsValidationError);
  });

  it('throws for vocabulary entries with empty strings', () => {
    expect(() =>
      createTraitsProvider(createBaseTraits({ vocabulary: ['', 'ok'] })),
    ).toThrowError(TraitsValidationError);
  });

  it('throws for zero preferred response length', () => {
    expect(() =>
      createTraitsProvider(createBaseTraits(), createSurfaceFormatting({ preferredResponseLength: 0 })),
    ).toThrowError(TraitsValidationError);
  });

  it('throws for non-integer preferred response length', () => {
    expect(() =>
      createTraitsProvider(createBaseTraits(), createSurfaceFormatting({ preferredResponseLength: 1.5 })),
    ).toThrowError(TraitsValidationError);
  });

  it('throws for non-boolean preferRichBlocks', () => {
    expect(() =>
      createTraitsProvider(
        createBaseTraits(),
        createSurfaceFormatting({ preferRichBlocks: 'yes' as unknown as boolean }),
      ),
    ).toThrowError(TraitsValidationError);
  });

  it('throws for non-boolean preferMarkdown', () => {
    expect(() =>
      createTraitsProvider(
        createBaseTraits(),
        createSurfaceFormatting({ preferMarkdown: 'yes' as unknown as boolean }),
      ),
    ).toThrowError(TraitsValidationError);
  });

  it('warns and accepts an unknown voice value', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(() =>
      createTraitsProvider(createBaseTraits({ voice: 'empathetic' })),
    ).not.toThrow();

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('preserves an unknown voice value on the provider', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const provider = createTraitsProvider(createBaseTraits({ voice: 'empathetic' }));

    expect(provider.traits.voice).toBe('empathetic');
  });

  it('freezes the provider and nested trait objects', () => {
    const provider = createTraitsProvider(createBaseTraits(), createSurfaceFormatting());

    expect(Object.isFrozen(provider)).toBe(true);
    expect(Object.isFrozen(provider.traits)).toBe(true);
    expect(Object.isFrozen(provider.surfaceFormatting as object)).toBe(true);
  });

  it('rejects mutation of provider traits', () => {
    const provider = createTraitsProvider(createBaseTraits());

    expect(() => {
      (provider.traits as AssistantTraits).voice = 'formal';
    }).toThrow(TypeError);
    expect(provider.traits.voice).toBe('concise');
  });

  it('rejects mutation of surface formatting', () => {
    const provider = createTraitsProvider(createBaseTraits(), createSurfaceFormatting());

    expect(() => {
      (provider.surfaceFormatting as SurfaceFormattingTraits).preferMarkdown = false;
    }).toThrow(TypeError);
    expect(provider.surfaceFormatting?.preferMarkdown).toBe(true);
  });

  it('rejects adding a new key to traits', () => {
    const provider = createTraitsProvider(createBaseTraits());

    expect(() => {
      Object.assign(provider.traits as Record<string, unknown>, { extra: 'nope' });
    }).toThrow(TypeError);
    expect('extra' in provider.traits).toBe(false);
  });

  it('is unaffected by later mutations to the original inputs', () => {
    const traits = createBaseTraits({
      domain: 'code-review',
      vocabulary: ['PR', 'diff'],
    });
    const surfaceFormatting = createSurfaceFormatting({ preferMarkdown: true });

    const provider = createTraitsProvider(traits, surfaceFormatting);

    traits.voice = 'formal';
    traits.vocabulary?.push('merge');
    surfaceFormatting.preferMarkdown = false;

    expect(provider.traits.voice).toBe('concise');
    expect(provider.traits.vocabulary).toEqual(['PR', 'diff']);
    expect(provider.surfaceFormatting?.preferMarkdown).toBe(true);
  });

  it('freezes the copied vocabulary array', () => {
    const provider = createTraitsProvider(
      createBaseTraits({ vocabulary: ['digest', 'workspace'] }),
    );

    expect(Object.isFrozen(provider.traits.vocabulary as object)).toBe(true);
    expect(() => {
      (provider.traits.vocabulary as string[]).push('capture');
    }).toThrow(TypeError);
  });

  it('exposes the failing field on TraitsValidationError', () => {
    try {
      createTraitsProvider(createBaseTraits({ formality: 'semi-formal' }));
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(TraitsValidationError);
      expect((error as TraitsValidationError).field).toBe('formality');
    }
  });

  it('exposes the invalid value on TraitsValidationError', () => {
    try {
      createTraitsProvider(createBaseTraits({ riskPosture: 'reckless' }));
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(TraitsValidationError);
      expect((error as TraitsValidationError).invalidValue).toBe('reckless');
    }
  });

  it('preserves Error inheritance and a readable message', () => {
    try {
      createTraitsProvider(createBaseTraits({ proactivity: 'very-high' }));
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(TraitsValidationError);
      expect(error).toBeInstanceOf(Error);
      expect((error as TraitsValidationError).message).toMatch(/proactivity/);
      expect((error as TraitsValidationError).message).toMatch(/very-high/);
    }
  });
});
