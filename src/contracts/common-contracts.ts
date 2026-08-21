import { z } from "zod";

export const sourceStateSchema = z.enum([
  "live",
  "stale",
  "empty",
  "unavailable",
  "unsupported",
]);

export const provenanceSchema = z.enum(["observed", "calculated", "inferred"]);

export const sourceObservationSchema = z
  .object({
    state: sourceStateSchema,
    observedAt: z.string().min(1).nullable(),
    reason: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

export const publicErrorCodeSchema = z.enum([
  "BAD_REQUEST",
  "NOT_FOUND",
  "RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE",
  "SOURCE_UNAVAILABLE",
  "SOURCE_UNSUPPORTED",
  "INTERNAL_ERROR",
]);

export const publicErrorSchema = z
  .object({
    code: publicErrorCodeSchema,
    message: z.string().trim().min(1).max(160),
  })
  .strict();

export type SourceObservation = z.infer<typeof sourceObservationSchema>;
export type Provenance = z.infer<typeof provenanceSchema>;
export type PublicError = z.infer<typeof publicErrorSchema>;
