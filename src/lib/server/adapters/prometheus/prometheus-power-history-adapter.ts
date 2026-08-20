import {
  resolveHistoryRequest,
  type PowerEffectiveResolution,
  type PowerHistoryKey,
  type PowerHistoryPoint,
  type PowerHistoryProvider,
  type PowerHistoryRequest,
  type PowerHistoryResult,
  type PowerHistorySeries,
} from "@/domain/power";
import {
  parseUpstream,
  requestBoundedJson,
  UpstreamError,
  type Fetcher,
} from "@/lib/server/http/bounded-json";
import {
  prometheusMatrixResponseSchema,
  type PrometheusMatrixResponse,
} from "./prometheus-schemas";

const QUERY_SPECS = [
  { metric: "power_capacity", key: "capacityMw" },
  { metric: "power_consumed", key: "consumptionMw" },
  { metric: "power_max_consumed", key: "correctedMaximumConsumptionMw" },
] as const satisfies readonly { metric: string; key: PowerHistoryKey }[];

export interface PrometheusPowerHistoryAdapterOptions {
  baseUrl: string;
  urlLabel: string;
  sessionLabel: string;
  fetcher?: Fetcher;
  maxResponseBytes?: number;
  timeoutMs?: number;
  now?: () => Date;
}

const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5000;
const STEP_MS: Record<PowerEffectiveResolution, number> = {
  "15s": 15_000,
  "30s": 30_000,
  "1m": 60_000,
  "2m": 120_000,
  "5m": 300_000,
  "10m": 600_000,
  "15m": 900_000,
  "1h": 3_600_000,
};

/** Fixed-query Prometheus range adapter; selectors are server-owned only. */
export class PrometheusPowerHistoryAdapter implements PowerHistoryProvider {
  private readonly baseUrl: string;
  private readonly urlLabel: string;
  private readonly sessionLabel: string;
  private readonly fetcher: Fetcher;
  private readonly maxResponseBytes: number;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(options: PrometheusPowerHistoryAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.urlLabel = options.urlLabel;
    this.sessionLabel = options.sessionLabel;
    this.fetcher = options.fetcher ?? fetch;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
  }

  async getHistory(request: PowerHistoryRequest): Promise<PowerHistoryResult> {
    const plan = resolveHistoryRequest(request, this.now());
    if (!plan.supported) {
      return {
        observedAt: null,
        coverage: {
          state: "unsupported",
          reason: plan.reason,
          requestedRange: request.range,
          effectiveResolution: plan.effectiveResolution,
          retentionHorizonDays: 15,
          oldestSampleAt: null,
          newestSampleAt: null,
        },
        series: [],
      };
    }
    const effective = plan.effectiveResolution;
    const startSeconds = Math.floor(plan.startAt.getTime() / 1000);
    const endSeconds = Math.floor(plan.endAt.getTime() / 1000);

    const responses = await Promise.all(
      QUERY_SPECS.map(async (spec) => ({
        spec,
        response: await this.query(spec.metric, startSeconds, endSeconds, effective),
      }))
    );

    const series = responses.flatMap(({ spec, response }) =>
      this.normalizeResponse(spec.metric, spec.key, response)
    );
    if (series.length > 100) {
      throw new UpstreamError("UPSTREAM_SCHEMA_INVALID");
    }
    series.sort(compareSeries);

    let pointCount = 0;
    let oldestMs = Number.POSITIVE_INFINITY;
    let newestMs = Number.NEGATIVE_INFINITY;
    for (const item of series) {
      for (const point of item.points) {
        const timestamp = Date.parse(point.timestamp);
        pointCount += 1;
        oldestMs = Math.min(oldestMs, timestamp);
        newestMs = Math.max(newestMs, timestamp);
      }
    }
    if (pointCount === 0) {
      return {
        observedAt: null,
        coverage: {
          state: "empty",
          requestedRange: request.range,
          effectiveResolution: effective,
          retentionHorizonDays: 15,
          oldestSampleAt: null,
          newestSampleAt: null,
        },
        series: [],
      };
    }

    const stepMs = STEP_MS[effective];
    const complete =
      new Set(series.map((item) => item.key)).size === QUERY_SPECS.length &&
      series.every((item) => {
        const first = Date.parse(item.points[0]?.timestamp ?? "");
        const last = Date.parse(item.points[item.points.length - 1]?.timestamp ?? "");
        return first <= startSeconds * 1000 + stepMs && last >= endSeconds * 1000 - stepMs;
      });

    return {
      observedAt: new Date(newestMs).toISOString(),
      coverage: {
        state: complete ? "complete" : "partial",
        requestedRange: request.range,
        effectiveResolution: effective,
        retentionHorizonDays: 15,
        oldestSampleAt: new Date(oldestMs).toISOString(),
        newestSampleAt: new Date(newestMs).toISOString(),
      },
      series,
    };
  }

  private async query(
    metric: string,
    startSeconds: number,
    endSeconds: number,
    step: PowerEffectiveResolution
  ): Promise<PrometheusMatrixResponse> {
    const query = `${metric}{url="${escapePrometheusString(this.urlLabel)}",session_name="${escapePrometheusString(this.sessionLabel)}"}`;
    const url = new URL(`${this.baseUrl}/api/v1/query_range`);
    url.searchParams.set("query", query);
    url.searchParams.set("start", String(startSeconds));
    url.searchParams.set("end", String(endSeconds));
    url.searchParams.set("step", step);
    const raw = await requestBoundedJson({
      url,
      fetcher: this.fetcher,
      maxResponseBytes: this.maxResponseBytes,
      timeoutMs: this.timeoutMs,
    });
    return parseUpstream(prometheusMatrixResponseSchema, raw);
  }

  private normalizeResponse(
    expectedMetric: string,
    key: PowerHistoryKey,
    response: PrometheusMatrixResponse
  ): PowerHistorySeries[] {
    const seen = new Set<string>();
    return response.data.result.map((rawSeries) => {
      const labels = rawSeries.metric;
      if (
        labels.__name__ !== expectedMetric ||
        labels.url !== this.urlLabel ||
        labels.session_name !== this.sessionLabel ||
        seen.has(labels.circuit_id)
      ) {
        throw new UpstreamError("UPSTREAM_SCHEMA_INVALID");
      }
      seen.add(labels.circuit_id);
      const points = rawSeries.values.map(([rawTimestamp, rawValue]) =>
        normalizePoint(rawTimestamp, rawValue)
      );
      points.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
      for (let index = 1; index < points.length; index += 1) {
        if (points[index]?.timestamp === points[index - 1]?.timestamp) {
          throw new UpstreamError("UPSTREAM_SCHEMA_INVALID");
        }
      }
      return { key, circuitId: labels.circuit_id, points };
    });
  }
}

function normalizePoint(rawTimestamp: number | string, rawValue: string): PowerHistoryPoint {
  const timestampSeconds = typeof rawTimestamp === "number" ? rawTimestamp : Number(rawTimestamp);
  const value = Number(rawValue);
  if (!Number.isFinite(timestampSeconds) || timestampSeconds < 0 || !Number.isFinite(value)) {
    throw new UpstreamError("UPSTREAM_SCHEMA_INVALID");
  }
  const date = new Date(timestampSeconds * 1000);
  if (!Number.isFinite(date.getTime())) throw new UpstreamError("UPSTREAM_SCHEMA_INVALID");
  return { timestamp: date.toISOString(), value };
}

function escapePrometheusString(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

function compareSeries(a: PowerHistorySeries, b: PowerHistorySeries): number {
  const keyOrder = QUERY_SPECS.findIndex((spec) => spec.key === a.key) - QUERY_SPECS.findIndex((spec) => spec.key === b.key);
  if (keyOrder !== 0) return keyOrder;
  return BigInt(a.circuitId) < BigInt(b.circuitId) ? -1 : BigInt(a.circuitId) > BigInt(b.circuitId) ? 1 : 0;
}
