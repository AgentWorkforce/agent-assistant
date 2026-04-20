import type { TelemetryEvent, TelemetrySink } from './types.js';

export interface MinimalR2Bucket {
  put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
}

export class R2TelemetrySink implements TelemetrySink {
  private readonly bucket: MinimalR2Bucket;
  private readonly prefix: string;
  private readonly httpMetadata: { contentType: string };

  constructor(opts: {
    bucket: MinimalR2Bucket;
    prefix?: string;
    httpMetadata?: { contentType: string };
  }) {
    this.bucket = opts.bucket;
    this.prefix = opts.prefix ?? 'turns';
    this.httpMetadata = opts.httpMetadata ?? { contentType: 'application/json' };
  }

  async emit(event: TelemetryEvent): Promise<void> {
    const { year, month, day } = getDateParts(event.timestamp);
    const turnId = event.turnId.replace(/\//g, '_');
    const key = `${this.prefix}/${year}/${month}/${day}/${turnId}.json`;

    await this.bucket.put(key, JSON.stringify(event), {
      httpMetadata: this.httpMetadata,
    });
  }
}

function getDateParts(timestamp: string): { year: string; month: string; day: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(timestamp);
  const [, year, month, day] = match ?? [];
  if (year && month && day) {
    return { year, month, day };
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid telemetry event timestamp: ${timestamp}`);
  }

  return {
    year: String(date.getUTCFullYear()),
    month: String(date.getUTCMonth() + 1).padStart(2, '0'),
    day: String(date.getUTCDate()).padStart(2, '0'),
  };
}
