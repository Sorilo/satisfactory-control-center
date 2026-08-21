import { describe, expect, it } from "vitest";
import {
  isSourceState,
  sourceStateFromResult,
  type SourceState,
  type SourceObservation,
} from "./source-state";

describe("source state", () => {
  it("accepts only the public source-state vocabulary", () => {
    const states: SourceState[] = ["live", "stale", "empty", "unavailable", "unsupported"];
    expect(states.every(isSourceState)).toBe(true);
    expect(isSourceState("private-error")).toBe(false);
    expect(isSourceState(null)).toBe(false);
  });

  it("distinguishes a successful empty result from an unavailable result", () => {
    const empty = sourceStateFromResult({ kind: "success", empty: true, observedAt: "2026-08-21T03:20:00.000Z" });
    const live = sourceStateFromResult({ kind: "success", empty: false, observedAt: "2026-08-21T03:20:00.000Z" });
    const unavailable = sourceStateFromResult({ kind: "failure", reason: "timeout" });

    expect(empty).toEqual<SourceObservation>({ state: "empty", observedAt: "2026-08-21T03:20:00.000Z" });
    expect(live).toEqual<SourceObservation>({ state: "live", observedAt: "2026-08-21T03:20:00.000Z" });
    expect(unavailable).toEqual<SourceObservation>({ state: "unavailable", observedAt: null, reason: "timeout" });
  });

  it("preserves stale observations with a sanitized reason", () => {
    expect(sourceStateFromResult({
      kind: "stale",
      observedAt: "2026-08-21T03:19:00.000Z",
      reason: "upstream temporarily unavailable",
    })).toEqual({
      state: "stale",
      observedAt: "2026-08-21T03:19:00.000Z",
      reason: "upstream temporarily unavailable",
    });
  });
});
