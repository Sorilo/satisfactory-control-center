import { z } from "zod";
import { sourceStateSchema, provenanceSchema } from "./common-contracts";

const publicServerIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const itemKeySchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);

export const productionQuerySchema = z.object({
  serverId: publicServerIdSchema,
  search: z.string().trim().min(1).max(80).optional(),
  itemKey: itemKeySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();

export const productionProvenanceSchema = z.object({
  throughput: provenanceSchema,
  capacity: provenanceSchema,
  net: z.literal("calculated"),
}).strict();

export const productionItemSchema = z.object({
  itemKey: itemKeySchema,
  name: z.string().min(1).max(120),
  form: z.enum(["Solid", "Liquid", "Gas", "Unknown"]),
  productionPerMinute: z.number().finite().nonnegative(),
  consumptionPerMinute: z.number().finite().nonnegative(),
  maxProductionPerMinute: z.number().finite().nonnegative(),
  maxConsumptionPerMinute: z.number().finite().nonnegative(),
  netPerMinute: z.number().finite(),
  productionEfficiencyPercent: z.number().finite().min(0).max(100),
  consumptionEfficiencyPercent: z.number().finite().min(0).max(100),
  provenance: productionProvenanceSchema,
}).strict();

export const productionHistorySchema = z.object({
  state: z.literal("unsupported"),
  reason: z.literal("production-history-not-observed"),
}).strict();

export const productionDataSchema = z.object({
  items: z.array(productionItemSchema).max(100),
  total: z.number().int().min(0).max(100),
  history: productionHistorySchema,
}).strict();

export const productionEnvelopeSchema = z.object({
  apiVersion: z.literal("v1"),
  generatedAt: z.string().datetime(),
  serverId: publicServerIdSchema,
  freshness: z.object({
    state: sourceStateSchema,
    observedAt: z.string().datetime().nullable(),
  }).strict(),
  data: productionDataSchema.nullable(),
  unavailableSources: z.array(z.enum(["frm", "prometheus", "postgres"])),
}).strict();

export type ProductionEnvelope = z.infer<typeof productionEnvelopeSchema>;
export type ProductionQuery = z.infer<typeof productionQuerySchema>;
