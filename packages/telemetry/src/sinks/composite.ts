import type { TelemetryEvent, TelemetrySink } from './types.js';

export class CompositeTelemetrySink implements TelemetrySink {
  constructor(private readonly sinks: TelemetrySink[]) {}

  async emit(event: TelemetryEvent): Promise<void> {
    const results = await Promise.allSettled(
      this.sinks.map(async (sink) => sink.emit(event)),
    );

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn('[telemetry/composite]', index, result.reason);
      }
    });
  }
}
