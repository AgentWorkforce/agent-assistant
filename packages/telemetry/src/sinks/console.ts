import type { TelemetryEvent, TelemetrySink } from './types.js';

const TRANSCRIPT_OMIT_THRESHOLD_BYTES = 4 * 1024;
const OMITTED_TRANSCRIPT = '[omitted]';
const textEncoder = new TextEncoder();

type ConsoleTelemetrySinkLevel = 'full' | 'summary';

interface ConsoleTelemetrySinkOptions {
  level?: ConsoleTelemetrySinkLevel;
  logger?: (line: string) => void;
}

type ConsoleTelemetryEvent =
  | TelemetryEvent
  | (Omit<TelemetryEvent, 'transcript'> & { transcript: typeof OMITTED_TRANSCRIPT });

export class ConsoleTelemetrySink implements TelemetrySink {
  private readonly level: ConsoleTelemetrySinkLevel;
  private readonly logger: (line: string) => void;

  constructor(options: ConsoleTelemetrySinkOptions = {}) {
    this.level = options.level ?? 'full';
    this.logger = options.logger ?? console.log;
  }

  emit(event: TelemetryEvent): void {
    const payload = this.serializeEvent(event);
    this.logger(`[telemetry] ${JSON.stringify(payload)}`);
  }

  private serializeEvent(event: TelemetryEvent): ConsoleTelemetryEvent {
    if (this.level === 'summary' || isLargeTranscript(event)) {
      return { ...event, transcript: OMITTED_TRANSCRIPT };
    }

    return event;
  }
}

function isLargeTranscript(event: TelemetryEvent): boolean {
  return (
    textEncoder.encode(JSON.stringify(event.transcript)).byteLength >
    TRANSCRIPT_OMIT_THRESHOLD_BYTES
  );
}
