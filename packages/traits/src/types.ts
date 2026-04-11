export interface AssistantTraits {
  voice: string;
  formality: string;
  proactivity: string;
  riskPosture: string;
  domain?: string;
  vocabulary?: string[];
}

export interface SurfaceFormattingTraits {
  preferredResponseLength?: number;
  preferRichBlocks?: boolean;
  preferMarkdown?: boolean;
}

export interface TraitsProvider {
  readonly traits: Readonly<AssistantTraits>;
  readonly surfaceFormatting?: Readonly<SurfaceFormattingTraits>;
}

export type TraitsField = keyof AssistantTraits | keyof SurfaceFormattingTraits;
