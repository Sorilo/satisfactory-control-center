import { z } from "zod";

const finiteNonnegative = z.number().finite().nonnegative();
const observedAtSchema = z.string().min(1);
const circuitIdSchema = z.string().regex(/^(0|[1-9]\d*)$/);
const opaqueServerIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);

export const powerRangeSchema = z.enum(["15m", "1h", "6h", "24h", "7d", "15d", "ytd", "1y", "lifetime", "custom"]);
export const powerResolutionSchema = z.enum(["auto", "15s", "30s", "1m", "2m", "5m", "10m", "15m", "1h"]);
export const powerEffectiveResolutionSchema = z.enum(["15s", "30s", "1m", "2m", "5m", "10m", "15m", "1h"]);
const customDateSchema = z.string().min(1).refine((value) => Number.isFinite(Date.parse(value)), "Invalid date");

const powerHistoryRequestBaseSchema = z
  .object({
    range: powerRangeSchema,
    resolution: powerResolutionSchema,
    startAt: customDateSchema.optional(),
    endAt: customDateSchema.optional(),
  })
  .strict();

export const powerHistoryRequestSchema = powerHistoryRequestBaseSchema.superRefine((value, context) => {
  if (value.range === "custom" && (!value.startAt || !value.endAt)) {
    context.addIssue({ code: "custom", message: "Custom ranges require startAt and endAt." });
  }
  if (value.range !== "custom" && (value.startAt || value.endAt)) {
    context.addIssue({ code: "custom", message: "startAt and endAt are only valid for custom ranges." });
  }
});

export const powerQuerySchema = z
  .object({
    serverId: opaqueServerIdSchema,
    range: powerRangeSchema,
    resolution: powerResolutionSchema,
    startAt: customDateSchema.optional(),
    endAt: customDateSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.range === "custom" && (!value.startAt || !value.endAt)) {
      context.addIssue({ code: "custom", message: "Custom ranges require startAt and endAt." });
    }
    if (value.range !== "custom" && (value.startAt || value.endAt)) {
      context.addIssue({ code: "custom", message: "startAt and endAt are only valid for custom ranges." });
    }
  });

const freshnessSchema = z
  .object({
    state: z.enum(["live", "stale", "unavailable"]),
    observedAt: z.union([observedAtSchema, z.null()]),
  })
  .strict();

const totalsSchema = z
  .object({
    capacityMw: finiteNonnegative,
    consumptionMw: finiteNonnegative,
    reportedMaximumConsumptionMw: finiteNonnegative,
    headroomMw: z.number().finite(),
    utilizationPercent: z.union([finiteNonnegative, z.null()]),
    fuseTriggered: z.boolean(),
  })
  .strict();

const batterySchema = z
  .object({
    chargePercent: z.number().finite().min(0).max(100),
    netFlowMw: z.number().finite(),
    secondsToEmpty: z.union([finiteNonnegative, z.null()]),
    secondsToFull: z.union([finiteNonnegative, z.null()]),
  })
  .strict();

const circuitSchema = z
  .object({
    id: circuitIdSchema,
    capacityMw: finiteNonnegative,
    consumptionMw: finiteNonnegative,
    reportedMaximumConsumptionMw: finiteNonnegative,
    headroomMw: z.number().finite(),
    utilizationPercent: z.union([finiteNonnegative, z.null()]),
    fuseTriggered: z.boolean(),
    associatedCircuitCount: z.number().int().nonnegative(),
    battery: z.union([batterySchema, z.null()]),
  })
  .strict();

const detailCircuitSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("connected"),
      id: circuitIdSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal("disconnected"),
      id: z.literal("-1"),
    })
    .strict(),
]);

const fuelInventorySchema = z
  .object({
    name: z.string().min(1).max(160),
    amount: finiteNonnegative,
    capacity: finiteNonnegative,
  })
  .strict();

export const powerGeneratorSchema = z
  .object({
    name: z.string().min(1).max(160),
    circuit: detailCircuitSchema,
    fuelType: z.enum([
      "biomass",
      "coal",
      "fuel",
      "geothermal",
      "nuclear",
      "unknown",
    ]),
    fuelInventory: z.union([fuelInventorySchema, z.null()]),
    productionCapacityMw: finiteNonnegative,
    loadPercent: z.number().finite().min(0).max(100),
    canStart: z.boolean(),
    fuseTriggered: z.boolean(),
  })
  .strict();

export const powerMajorConsumerSchema = z
  .object({
    name: z.string().min(1).max(160),
    circuit: detailCircuitSchema,
    consumptionMw: finiteNonnegative,
    maximumConsumptionMw: finiteNonnegative,
    fuseTriggered: z.boolean(),
  })
  .strict();

const detailState = <T extends z.ZodType>(itemSchema: T, maximum: number) =>
  z
    .object({
      state: z.enum(["live", "unavailable"]),
      items: z.array(itemSchema).max(maximum),
    })
    .strict();

const currentSchema = z
  .object({
    topologyState: z.enum(["available", "no-circuits"]),
    totals: totalsSchema,
    circuits: z.array(circuitSchema).max(100),
    generators: detailState(powerGeneratorSchema, 100),
    majorConsumers: detailState(powerMajorConsumerSchema, 10),
  })
  .strict();

const historyPointSchema = z
  .object({
    timestamp: observedAtSchema,
    value: z.number().finite(),
  })
  .strict();

const historySeriesSchema = z
  .object({
    key: z.enum([
      "capacityMw",
      "consumptionMw",
      "correctedMaximumConsumptionMw",
    ]),
    circuitId: circuitIdSchema,
    points: z.array(historyPointSchema).max(2_000),
  })
  .strict();

const historySchema = z
  .object({
    coverage: z
      .object({
        state: z.enum(["complete", "partial", "empty", "unsupported"]),
        reason: z.enum(["retention-unavailable", "resolution-too-fine", "custom-range-required", "invalid-custom-range"]).optional(),
        requestedRange: powerRangeSchema,
        effectiveResolution: powerEffectiveResolutionSchema,
        retentionHorizonDays: z.literal(15),
        oldestSampleAt: z.union([observedAtSchema, z.null()]),
        newestSampleAt: z.union([observedAtSchema, z.null()]),
      })
      .strict(),
    series: z.array(historySeriesSchema).max(100),
    production: z
      .object({
        state: z.literal("unavailable"),
        reason: z.literal("source-not-collected"),
      })
      .strict(),
  })
  .strict();

export const powerEnvelopeSchema = z
  .object({
    apiVersion: z.literal("v1"),
    generatedAt: observedAtSchema,
    serverId: opaqueServerIdSchema,
    freshness: z
      .object({
        current: freshnessSchema,
        history: freshnessSchema,
      })
      .strict(),
    data: z
      .object({
        current: z.union([currentSchema, z.null()]),
        history: z.union([historySchema, z.null()]),
      })
      .strict(),
    unavailableSources: z.array(z.enum(["frm", "prometheus"])).max(2),
  })
  .strict();

/** Realtime carries only the normalized current fields owned by getPower. */
export const powerStreamSnapshotSchema = z
  .object({
    observedAt: observedAtSchema,
    topologyState: z.enum(["available", "no-circuits"]),
    totals: totalsSchema,
    circuits: z.array(circuitSchema).max(100),
  })
  .strict();

/**
 * Realtime details carries only the independently-degraded generator and
 * major-consumer groups, with the same ISO-ish observedAt as the rest of the
 * public contract. Generators are capped at 100 and major consumers at 10.
 */
export const powerDetailsStreamSnapshotSchema = z
  .object({
    observedAt: observedAtSchema,
    generators: detailState(powerGeneratorSchema, 100),
    majorConsumers: detailState(powerMajorConsumerSchema, 10),
  })
  .strict();

export type PowerEnvelope = z.infer<typeof powerEnvelopeSchema>;
export type PowerQuery = z.infer<typeof powerQuerySchema>;
export type PowerHistoryRequestContract = z.infer<typeof powerHistoryRequestSchema>;
export type PowerStreamSnapshot = z.infer<typeof powerStreamSnapshotSchema>;
export type PowerDetailsStreamSnapshot = z.infer<typeof powerDetailsStreamSnapshotSchema>;
