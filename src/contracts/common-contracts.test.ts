import { describe, expect, it } from "vitest";
import {
  publicErrorSchema,
  provenanceSchema,
  sourceObservationSchema,
} from "./common-contracts";

describe("common public contracts", () => {
  it("accepts the shared source observation states", () => {
    expect(sourceObservationSchema.parse({ state: "empty", observedAt: "2026-08-21T03:20:00.000Z" })).toEqual({
      state: "empty",
      observedAt: "2026-08-21T03:20:00.000Z",
    });
    expect(sourceObservationSchema.parse({ state: "unsupported", observedAt: null, reason: "source-not-collected" })).toMatchObject({
      state: "unsupported",
      observedAt: null,
    });
  });

  it("rejects private or undeclared source fields", () => {
    expect(() => sourceObservationSchema.parse({
      state: "live",
      observedAt: "2026-08-21T03:20:00.000Z",
      url: "http://private",
    })).toThrow();
  });

  it("accepts provenance but rejects invented provenance", () => {
    expect(provenanceSchema.parse("calculated")).toBe("calculated");
    expect(() => provenanceSchema.parse("upstream-private")).toThrow();
  });

  it("exposes only stable public error codes and generic messages", () => {
    expect(publicErrorSchema.parse({ code: "UPSTREAM_UNAVAILABLE", message: "Realtime data is temporarily unavailable." })).toEqual({
      code: "UPSTREAM_UNAVAILABLE",
      message: "Realtime data is temporarily unavailable.",
    });
    expect(() => publicErrorSchema.parse({
      code: "UPSTREAM_UNAVAILABLE",
      message: "request failed",
      stack: "secret stack",
    })).toThrow();
  });
});
