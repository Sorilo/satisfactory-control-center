import { z } from "zod";

const prometheusTimestampSchema = z.union([
  z.number().finite().nonnegative(),
  z.string().min(1).max(64),
]);

export const prometheusValueSchema = z.tuple([
  prometheusTimestampSchema,
  z.string().min(1).max(128),
]);

export const prometheusMatrixSeriesSchema = z
  .object({
    metric: z
      .object({
        __name__: z.string().min(1).max(128),
        circuit_id: z.string().regex(/^(0|[1-9]\d{0,9})$/),
        url: z.string().max(2048),
        session_name: z.string().max(256),
      })
      .strict(),
    values: z.array(prometheusValueSchema).max(2000),
  })
  .strict();

export const prometheusMatrixResponseSchema = z
  .object({
    status: z.literal("success"),
    data: z
      .object({
        resultType: z.literal("matrix"),
        result: z.array(prometheusMatrixSeriesSchema).max(100),
      })
      .strict(),
  })
  .strict();

export type PrometheusMatrixResponse = z.infer<typeof prometheusMatrixResponseSchema>;
