import type { RetryResult } from "@/lib/server/http/bounded-json";

export type StructuredLogLevel = "debug" | "info" | "warn" | "error";
export type StructuredFailureCategory = "schema" | "transport" | "timeout" | "cancelled";

export interface StructuredLogEvent {
  message: string;
  requestId?: string;
  route?: string;
  serverId?: string;
  source?: string;
  adapter?: string;
  code?: string;
  state?: string;
  failureCategory?: StructuredFailureCategory;
  retryResult?: RetryResult;
  attempts?: number;
  schemaPath?: string;
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

const SAFE_SCHEMA_PATH = /^(?:response|root|(?:[A-Za-z][A-Za-z0-9_]{0,63}|\[\d{1,4}\])(?:\.(?:[A-Za-z][A-Za-z0-9_]{0,63}))*)$/;

function safeBoundedText(value: string, maxLength: number): string {
  return redactSensitiveText(value).slice(0, maxLength);
}

function safeSchemaPath(value: string): string {
  return SAFE_SCHEMA_PATH.test(value) ? value.slice(0, 160) : "[REDACTED_PATH]";
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
    ...(event.source ? { source: safeBoundedText(event.source, 64) } : {}),
    ...(event.adapter ? { adapter: safeBoundedText(event.adapter, 96) } : {}),
    ...(event.code ? { code: safeBoundedText(event.code, 80) } : {}),
    ...(event.state ? { state: safeBoundedText(event.state, 40) } : {}),
    ...(event.failureCategory ? { failureCategory: event.failureCategory } : {}),
    ...(event.retryResult ? { retryResult: event.retryResult } : {}),
    ...(typeof event.attempts === "number" && Number.isInteger(event.attempts)
      ? { attempts: Math.max(1, Math.min(2, event.attempts)) }
      : {}),
    ...(event.schemaPath ? { schemaPath: safeSchemaPath(event.schemaPath) } : {}),
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
