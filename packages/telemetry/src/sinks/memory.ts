import type { TelemetryEvent, TelemetrySink } from './types.js';

export class InMemoryTelemetrySink implements TelemetrySink {
  private buffer: TelemetryEvent[] = [];

  emit(event: TelemetryEvent): void {
    this.buffer.push(event);
  }

  events(): readonly TelemetryEvent[] {
    return [...this.buffer];
  }

  clear(): void {
    this.buffer = [];
  }
}
