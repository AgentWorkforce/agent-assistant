// Logger interface for cf-runtime. Persona-injectable; default implementation
// emits structured JSON to console (renders well in `wrangler tail --format
// json` and any log-collection pipeline that ingests CF Workers stdout).
//
// All cf-runtime entry points accept an optional `logger`; if omitted, they
// fall back to `consoleJsonLogger`. Pass `nullLogger` in tests to silence.

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface CfLogger {
  debug(event: string, data?: Record<string, unknown>): void;
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
  // Returns a new logger that merges `bindings` into every subsequent log line.
  // Use this to correlate by turnId / continuationId / conversationId.
  child(bindings: Record<string, unknown>): CfLogger;
}

interface ConsoleJsonLoggerOptions {
  // Minimum level to emit. Default "info".
  level?: LogLevel;
  // Static bindings merged into every log line (e.g. { service: "sage" }).
  bindings?: Record<string, unknown>;
  // Sink override — defaults to globalThis.console.
  sink?: Pick<Console, "debug" | "info" | "warn" | "error">;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

class ConsoleJsonLogger implements CfLogger {
  private readonly level: LogLevel;
  private readonly bindings: Record<string, unknown>;
  private readonly sink: NonNullable<ConsoleJsonLoggerOptions["sink"]>;

  constructor(opts: ConsoleJsonLoggerOptions = {}) {
    this.level = opts.level ?? "info";
    this.bindings = opts.bindings ?? {};
    this.sink = opts.sink ?? globalThis.console;
  }

  debug(event: string, data?: Record<string, unknown>): void {
    this.emit("debug", event, data);
  }
  info(event: string, data?: Record<string, unknown>): void {
    this.emit("info", event, data);
  }
  warn(event: string, data?: Record<string, unknown>): void {
    this.emit("warn", event, data);
  }
  error(event: string, data?: Record<string, unknown>): void {
    this.emit("error", event, data);
  }

  child(bindings: Record<string, unknown>): CfLogger {
    return new ConsoleJsonLogger({
      level: this.level,
      bindings: { ...this.bindings, ...bindings },
      sink: this.sink,
    });
  }

  private emit(level: LogLevel, event: string, data?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) return;
    const payload = {
      level,
      event,
      time: new Date().toISOString(),
      ...this.bindings,
      ...(data ?? {}),
    };
    // CF Workers stdout sees the JSON object; wrangler tail --format json
    // surfaces it as a structured event.
    const line = JSON.stringify(payload);
    if (level === "error") this.sink.error(line);
    else if (level === "warn") this.sink.warn(line);
    else if (level === "debug") this.sink.debug(line);
    else this.sink.info(line);
  }
}

export function createConsoleJsonLogger(opts?: ConsoleJsonLoggerOptions): CfLogger {
  return new ConsoleJsonLogger(opts);
}

// Convenience default — info level, console sink, no bindings.
export const consoleJsonLogger: CfLogger = createConsoleJsonLogger();

// Use in tests to silence output without losing the type.
export const nullLogger: CfLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return nullLogger;
  },
};

// Capturing logger for tests that want to assert on emitted events.
// Returns the logger plus an array that collects every emitted record.
export interface CapturedLogRecord {
  level: LogLevel;
  event: string;
  data: Record<string, unknown>;
}

export function createCapturingLogger(): {
  logger: CfLogger;
  records: CapturedLogRecord[];
} {
  const records: CapturedLogRecord[] = [];
  const make = (bindings: Record<string, unknown>): CfLogger => ({
    debug(event, data) {
      records.push({ level: "debug", event, data: { ...bindings, ...(data ?? {}) } });
    },
    info(event, data) {
      records.push({ level: "info", event, data: { ...bindings, ...(data ?? {}) } });
    },
    warn(event, data) {
      records.push({ level: "warn", event, data: { ...bindings, ...(data ?? {}) } });
    },
    error(event, data) {
      records.push({ level: "error", event, data: { ...bindings, ...(data ?? {}) } });
    },
    child(extra) {
      return make({ ...bindings, ...extra });
    },
  });
  return { logger: make({}), records };
}
