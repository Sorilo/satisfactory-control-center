export type StructuredLogLevel = "debug" | "info" | "warn" | "error";

export interface StructuredLogEvent {
  message: string;
  requestId?: string;
  route?: string;
  serverId?: string;
  code?: string;
  state?: string;
  durationMs?: number;
}

export interface StructuredLogger {
  debug(event: StructuredLogEvent): void;
  info(event: StructuredLogEvent): void;
  warn(event: StructuredLogEvent): void;
  error(event: StructuredLogEvent): void;
}

const SENSITIVE_KEY = /\b(authorization|cookie|token|password|secret|connectionString|connection-string|dsn)\b(\s*)([:=])\s*\S+/gi;
const URL = /https?:\/\/[^\s"'<>]+/gi;
const BEARER = /\bBearer\s+\S+/gi;

/** Redact secret-bearing text before it can enter a structured log sink. */
export function redactSensitiveText(value: string): string {
  return value
    .replace(URL, "[REDACTED_URL]")
    .replace(BEARER, "[REDACTED]")
    .replace(SENSITIVE_KEY, (_match, key: string, whitespace: string, delimiter: string) =>
      `${key}${whitespace}${delimiter}${delimiter === ":" ? " " : ""}[REDACTED]`
    );
}

function emit(
  sink: (line: string) => void,
  level: StructuredLogLevel,
  event: StructuredLogEvent
): void {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    message: redactSensitiveText(event.message),
    ...(event.requestId ? { requestId: redactSensitiveText(event.requestId) } : {}),
    ...(event.route ? { route: redactSensitiveText(event.route).slice(0, 160) } : {}),
    ...(event.serverId ? { serverId: redactSensitiveText(event.serverId).slice(0, 64) } : {}),
    ...(event.code ? { code: redactSensitiveText(event.code).slice(0, 80) } : {}),
    ...(event.state ? { state: redactSensitiveText(event.state).slice(0, 40) } : {}),
    ...(typeof event.durationMs === "number" && Number.isFinite(event.durationMs)
      ? { durationMs: Math.max(0, Math.round(event.durationMs)) }
      : {}),
  };
  sink(JSON.stringify(record));
}

export function createStructuredLogger(
  sink: (line: string) => void = (line) => process.stdout.write(`${line}\n`)
): StructuredLogger {
  return {
    debug: (event) => emit(sink, "debug", event),
    info: (event) => emit(sink, "info", event),
    warn: (event) => emit(sink, "warn", event),
    error: (event) => emit(sink, "error", event),
  };
}
