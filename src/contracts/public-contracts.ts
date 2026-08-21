import { z } from "zod";
import { sourceStateSchema } from "./common-contracts";

/**
 * Public, versioned v1 contracts. These are strict allowlists: undeclared
 * fields are rejected at the public boundary, and no internal field (URL,
 * token, hostname, inventory, or location) is ever declared here.
 */

const publicServerEntrySchema = z
  .object({
    id: z.string(),
    displayName: z.string(),
  })
  .strict();

export const serverCatalogSchema = z
  .object({
    defaultServerId: z.string(),
    servers: z.array(publicServerEntrySchema),
  })
  .strict();

export const freshnessStateSchema = sourceStateSchema;

export const unavailableSourceSchema = z.enum(["frm", "prometheus", "postgres"]);

export const overviewDataSchema = z
  .object({
    server: z.object({ online: z.boolean() }).strict(),
    session: z.union([
      z
        .object({
          name: z.string(),
          uptimeSeconds: z.number().finite().nonnegative(),
          paused: z.boolean(),
        })
        .strict(),
      z.null(),
    ]),
    players: z
      .object({
        online: z.number().int().nonnegative(),
        names: z.array(z.string()),
      })
      .strict(),
    power: z.union([
      z
        .object({
          capacityMw: z.number().finite().nonnegative(),
          consumptionMw: z.number().finite().nonnegative(),
          headroomMw: z.number().finite(),
          utilizationPercent: z.union([z.number().finite().nonnegative(), z.null()]),
          fuseTriggered: z.boolean(),
        })
        .strict(),
      z.null(),
    ]),
    factory: z
      .object({
        machineCount: z.number().int().nonnegative(),
        producingCount: z.number().int().nonnegative(),
        averageEfficiencyPercent: z.union([z.number().finite().min(0).max(100), z.null()]),
      })
      .strict(),
    progress: z.union([
      z
        .object({
          items: z.array(
            z
              .object({
                name: z.string(),
                delivered: z.number().finite().nonnegative(),
                required: z.number().finite().positive(),
              })
              .strict()
          ),
        })
        .strict(),
      z.null(),
    ]),
  })
  .strict();

export const overviewEnvelopeSchema = z
  .object({
    apiVersion: z.literal("v1"),
    generatedAt: z.string(),
    serverId: z.string(),
    freshness: z
      .object({
        state: freshnessStateSchema,
        observedAt: z.union([z.string(), z.null()]),
      })
      .strict(),
    data: z.union([overviewDataSchema, z.null()]),
    unavailableSources: z.array(unavailableSourceSchema),
  })
  .strict();

export type ServerCatalog = z.infer<typeof serverCatalogSchema>;
export type OverviewData = z.infer<typeof overviewDataSchema>;
export type OverviewEnvelope = z.infer<typeof overviewEnvelopeSchema>;
export type UnavailableSource = z.infer<typeof unavailableSourceSchema>;
export type FreshnessState = z.infer<typeof freshnessStateSchema>;
