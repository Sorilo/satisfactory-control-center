import { describe, expect, it, vi } from "vitest";
import {
  POWER_HISTORY_RANGES,
  POWER_HISTORY_RESOLUTIONS,
  effectiveResolution,
  type PowerHistoryKey,
} from "@/domain/power";
import { PrometheusPowerHistoryAdapter } from "./prometheus-power-history-adapter";

const METRIC_TO_KEY: Record<string, PowerHistoryKey> = {
  power_capacity: "capacityMw",
  power_consumed: "consumptionMw",
  power_max_consumed: "correctedMaximumConsumptionMw",
};

const RANGE_SECONDS = {
  "1h": 3600,
  "6h": 21600,
  "24h": 86400,
  "7d": 604800,
  "15d": 1296000,
} as const;

function matrix(
  metricName: string,
  values: Array<[number | string, string]> = [
    ["1787072400", "10"],
    [1787076000, "12.5"],
  ],
  metricExtra: Record<string, string> = {}
) {
  return {
    status: "success",
    data: {
      resultType: "matrix",
      result: [
        {
          metric: {
            __name__: metricName,
            circuit_id: "7",
            url: 'http://frm/with"quote',
            session_name: "Main\\World",
            ...metricExtra,
          },
          values,
        },
      ],
    },
  };
}

function response(value: unknown) {
  const body = JSON.stringify(value);
  return new Response(body, {
    headers: { "content-type": "application/json", "content-length": String(body.length) },
  });
}

function adapter(fetcher: typeof fetch, now = "2026-08-18T18:00:00.000Z") {
  return new PrometheusPowerHistoryAdapter({
    baseUrl: "http://prometheus:9090/",
    urlLabel: 'http://frm/with"quote',
    sessionLabel: "Main\\World",
    fetcher,
    now: () => new Date(now),
  });
}

describe("Prometheus power history adapter", () => {
  it("uses fixed templates and enforces every range/resolution cell", async () => {
    for (const range of POWER_HISTORY_RANGES) {
      for (const resolution of POWER_HISTORY_RESOLUTIONS) {
        const calls: URL[] = [];
        const fetcher = vi.fn(async (input: string | URL | Request) => {
          const url = new URL(String(input));
          calls.push(url);
          const query = url.searchParams.get("query") ?? "";
          const metric = Object.keys(METRIC_TO_KEY).find((name) => query.startsWith(`${name}{`));
          if (!metric) throw new Error("unexpected query");
          return response(matrix(metric, []));
        });
        await adapter(fetcher as typeof fetch).getHistory({ range, resolution });
        expect(calls).toHaveLength(3);
        const effective = effectiveResolution(range, resolution);
        expect(new Set(calls.map((url) => url.searchParams.get("step")))).toEqual(new Set([effective]));
        expect(new Set(calls.map((url) => url.pathname))).toEqual(new Set(["/api/v1/query_range"]));
        for (const url of calls) {
          expect(url.searchParams.get("end")).toBe("1787076000");
          expect(url.searchParams.get("start")).toBe(
            String(1787076000 - RANGE_SECONDS[range])
          );
          expect(url.searchParams.get("query")).toMatch(
            /^power_(capacity|consumed|max_consumed)\{url="http:\/\/frm\/with\\"quote",session_name="Main\\\\World"\}$/
          );
        }
      }
    }
  });

  it("normalizes exact matrix labels, numeric strings, ordering, and coverage", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const query = new URL(String(input)).searchParams.get("query") ?? "";
      const metric = Object.keys(METRIC_TO_KEY).find((name) => query.startsWith(`${name}{`));
      if (!metric) throw new Error("unexpected query");
      return response(matrix(metric));
    });
    const result = await adapter(fetcher as typeof fetch).getHistory({ range: "1h", resolution: "auto" });
    expect(result).toEqual({
      observedAt: "2026-08-18T18:00:00.000Z",
      coverage: {
        state: "complete",
        requestedRange: "1h",
        effectiveResolution: "1m",
        retentionHorizonDays: 15,
        oldestSampleAt: "2026-08-18T17:00:00.000Z",
        newestSampleAt: "2026-08-18T18:00:00.000Z",
      },
      series: [
        { key: "capacityMw", circuitId: "7", points: [{ timestamp: "2026-08-18T17:00:00.000Z", value: 10 }, { timestamp: "2026-08-18T18:00:00.000Z", value: 12.5 }] },
        { key: "consumptionMw", circuitId: "7", points: [{ timestamp: "2026-08-18T17:00:00.000Z", value: 10 }, { timestamp: "2026-08-18T18:00:00.000Z", value: 12.5 }] },
        { key: "correctedMaximumConsumptionMw", circuitId: "7", points: [{ timestamp: "2026-08-18T17:00:00.000Z", value: 10 }, { timestamp: "2026-08-18T18:00:00.000Z", value: 12.5 }] },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/url|session_name|prometheus|query/);
  });

  it("reports valid empty and partial retained history distinctly", async () => {
    const emptyFetcher = vi.fn(async (input: string | URL | Request) => {
      const query = new URL(String(input)).searchParams.get("query") ?? "";
      const metric = Object.keys(METRIC_TO_KEY).find((name) => query.startsWith(`${name}{`))!;
      return response(matrix(metric, []).data ? { status: "success", data: { resultType: "matrix", result: [] } } : null);
    });
    const empty = await adapter(emptyFetcher as typeof fetch).getHistory({ range: "24h", resolution: "5m" });
    expect(empty.coverage.state).toBe("empty");
    expect(empty.observedAt).toBeNull();
    expect(empty.series).toEqual([]);

    const partialFetcher = vi.fn(async (input: string | URL | Request) => {
      const query = new URL(String(input)).searchParams.get("query") ?? "";
      const metric = Object.keys(METRIC_TO_KEY).find((name) => query.startsWith(`${name}{`))!;
      return response(matrix(metric, [[1787074200, "10"]]));
    });
    const partial = await adapter(partialFetcher as typeof fetch).getHistory({ range: "1h", resolution: "1m" });
    expect(partial.coverage.state).toBe("partial");
  });

  it("rejects NaN/Inf, duplicate series, unexpected labels, names, and timestamps", async () => {
    const baseSeries = matrix("power_capacity").data.result[0];
    const invalids = [
      matrix("power_capacity", [[1787076000, "NaN"]]),
      matrix("power_capacity", [[1787076000, "+Inf"]]),
      matrix("power_capacity", [["not-time", "1"]]),
      matrix("power_capacity", undefined, { instance: "private:9090" }),
      matrix("wrong_metric"),
      {
        status: "success",
        data: { resultType: "matrix", result: [baseSeries, baseSeries] },
      },
      {
        status: "success",
        data: { resultType: "matrix", result: Array.from({ length: 101 }, () => baseSeries) },
      },
      matrix(
        "power_capacity",
        Array.from({ length: 2001 }, (_, index) => [1787070000 + index, "1"])
      ),
    ];
    for (const invalid of invalids) {
      const fetcher = vi.fn(async () => response(invalid));
      await expect(adapter(fetcher as typeof fetch).getHistory({ range: "1h", resolution: "1m" })).rejects.toMatchObject({ code: "UPSTREAM_SCHEMA_INVALID" });
    }
  });

  it("rejects combined cardinality above the public 100-series cap", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const query = new URL(String(input)).searchParams.get("query") ?? "";
      const metric = Object.keys(METRIC_TO_KEY).find((name) => query.startsWith(`${name}{`))!;
      const base = matrix(metric).data.result[0]!;
      return response({
        status: "success",
        data: {
          resultType: "matrix",
          result: Array.from({ length: 34 }, (_, circuitId) => ({
            ...base,
            metric: { ...base.metric, circuit_id: String(circuitId) },
          })),
        },
      });
    });
    await expect(adapter(fetcher as typeof fetch).getHistory({ range: "1h", resolution: "1m" })).rejects.toMatchObject({ code: "UPSTREAM_SCHEMA_INVALID" });
  });

  it("rejects Prometheus warnings/errors and bounded transport failures", async () => {
    for (const invalid of [
      { status: "error", errorType: "bad_data", error: "private query" },
      { status: "success", warnings: ["private warning"], data: { resultType: "matrix", result: [] } },
    ]) {
      const fetcher = vi.fn(async () => response(invalid));
      await expect(adapter(fetcher as typeof fetch).getHistory({ range: "1h", resolution: "1m" })).rejects.toMatchObject({ code: "UPSTREAM_SCHEMA_INVALID" });
    }
    const tooLarge = vi.fn(async () => new Response("{}", { headers: { "content-length": "9999" } }));
    const bounded = new PrometheusPowerHistoryAdapter({
      baseUrl: "http://prometheus:9090",
      urlLabel: "u",
      sessionLabel: "s",
      fetcher: tooLarge as typeof fetch,
      maxResponseBytes: 100,
    });
    await expect(bounded.getHistory({ range: "1h", resolution: "1m" })).rejects.toMatchObject({ code: "UPSTREAM_RESPONSE_TOO_LARGE" });
  });

  it("inherits redirect refusal and timeout semantics", async () => {
    const redirect = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      throw new TypeError("redirect refused");
    });
    await expect(adapter(redirect as typeof fetch).getHistory({ range: "1h", resolution: "1m" })).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });

    const timeoutFetcher = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        })
    );
    const timed = new PrometheusPowerHistoryAdapter({
      baseUrl: "http://prometheus:9090",
      urlLabel: "u",
      sessionLabel: "s",
      fetcher: timeoutFetcher as typeof fetch,
      timeoutMs: 1,
    });
    await expect(timed.getHistory({ range: "1h", resolution: "1m" })).rejects.toMatchObject({ code: "UPSTREAM_TIMEOUT" });
  });
});
