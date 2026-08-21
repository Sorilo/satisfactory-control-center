export const SOURCE_STATES = [
  "live",
  "stale",
  "empty",
  "unavailable",
  "unsupported",
] as const;

export type SourceState = (typeof SOURCE_STATES)[number];

export interface SourceObservation {
  state: SourceState;
  observedAt: string | null;
  reason?: string;
}

export type SourceResult =
  | { kind: "success"; empty: boolean; observedAt: string }
  | { kind: "failure"; reason: string }
  | { kind: "stale"; observedAt: string; reason?: string };

export function isSourceState(value: unknown): value is SourceState {
  return typeof value === "string" && SOURCE_STATES.includes(value as SourceState);
}

/** Convert an adapter result into a public-safe state without conflating empty and failed reads. */
export function sourceStateFromResult(result: SourceResult): SourceObservation {
  switch (result.kind) {
    case "success":
      return {
        state: result.empty ? "empty" : "live",
        observedAt: result.observedAt,
      };
    case "stale":
      return {
        state: "stale",
        observedAt: result.observedAt,
        ...(result.reason ? { reason: result.reason } : {}),
      };
    case "failure":
      return {
        state: "unavailable",
        observedAt: null,
        reason: result.reason,
      };
  }
}
