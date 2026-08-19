import { afterEach, describe, expect, it, vi } from "vitest";
import type { PowerStreamSnapshot } from "@/contracts/power-contracts";
import type { RuntimeConfig } from "@/lib/server/config/runtime-config";
import {
  PowerStreamConnectionGate,
  handlePowerStreamRequest,
  type PowerStreamAggregatorPort,
} from "./route";

function snapshot(observedAt = "2026-08-18T18:00:00.000Z"): PowerStreamSnapshot {
  return {
    observedAt,
    topologyState: "available",
    totals: {
      capacityMw: 100,
      consumptionMw: 80,
      reportedMaximumConsumptionMw: 90,
      headroomMw: 20,
      utilizationPercent: 80,
      fuseTriggered: false,
    },
    circuits: [{
      id: "7",
      capacityMw: 100,
      consumptionMw: 80,
      reportedMaximumConsumptionMw: 90,
      headroomMw: 20,
      utilizationPercent: 80,
      fuseTriggered: false,
      associatedCircuitCount: 1,
      battery: null,
    }],
  };
}

function config(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    dataMode: "mock",
    defaultServerId: "main",
    servers: [{
      id: "main",
      displayName: "Main World",
      frmBaseUrl: "",
      frmToken: null,
      enabled: true,
      public: true,
    }],
    prometheusServers: [],
    trustProxyHeaders: false,
    powerStreamEnabled: true,
    ...overrides,
  };
}

class FakeAggregator implements PowerStreamAggregatorPort {
  listener: ((value: PowerStreamSnapshot, sequence: number) => void) | null = null;
  unsubscribe = vi.fn();
  replay: { value: PowerStreamSnapshot; sequence: number } | null = null;
  shouldThrow = false;

  subscribeSequenced(
    _serverId: string,
    listener: (value: PowerStreamSnapshot, sequence: number) => void
  ): () => void {
    if (this.shouldThrow) throw new Error("private producer failure");
    this.listener = listener;
    if (this.replay) listener(this.replay.value, this.replay.sequence);
    return this.unsubscribe;
  }

  emit(value: PowerStreamSnapshot, sequence: number) {
    this.listener?.(value, sequence);
  }
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  pattern: RegExp,
  maximumReads = 5
): Promise<string> {
  const decoder = new TextDecoder();
  let output = "";
  for (let index = 0; index < maximumReads; index += 1) {
    const result = await reader.read();
    if (result.done) break;
    output += decoder.decode(result.value, { stream: true });
    if (pattern.test(output)) return output;
  }
  return output;
}

function request(
  path = "/api/v1/power/stream?serverId=main",
  options: { signal?: AbortSignal; headers?: HeadersInit } = {}
) {
  return new Request(`http://localhost${path}`, options);
}

const openStreams: Array<ReadableStreamDefaultReader<Uint8Array>> = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(openStreams.splice(0).map((reader) => reader.cancel().catch(() => undefined)));
});

describe("power SSE route", () => {
  it("returns SSE headers, retry hint, initial replay, sequenced updates, and no private fields", async () => {
    const aggregator = new FakeAggregator();
    aggregator.replay = { value: snapshot(), sequence: 4 };
    const response = handlePowerStreamRequest(request(), {
      config: config(),
      aggregator,
      connectionGate: new PowerStreamConnectionGate(),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-store, no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");

    const reader = response.body!.getReader();
    openStreams.push(reader);
    const initial = await readUntil(reader, /event: power/);
    expect(initial).toContain("retry: 5000");
    expect(initial).toContain("id: main:4");
    expect(initial).toContain("event: power");
    expect(initial).toContain('"capacityMw":100');
    expect(initial).not.toMatch(/PowerProduction|session_name|private|history|generators|url/i);

    aggregator.emit(snapshot("2026-08-18T18:00:05.000Z"), 5);
    const update = await readUntil(reader, /main:5/);
    expect(update).toContain("id: main:5");
    expect(update).toContain("event: power");
  });

  it("emits a heartbeat every 15 seconds and unsubscribes on request abort", async () => {
    vi.useFakeTimers();
    const aggregator = new FakeAggregator();
    const controller = new AbortController();
    const response = handlePowerStreamRequest(request(undefined, { signal: controller.signal }), {
      config: config(),
      aggregator,
      connectionGate: new PowerStreamConnectionGate(),
    });
    const reader = response.body!.getReader();
    openStreams.push(reader);
    await readUntil(reader, /retry: 5000/);

    const heartbeat = readUntil(reader, /heartbeat/);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await heartbeat).toMatch(/: heartbeat/);

    controller.abort();
    await Promise.resolve();
    expect(aggregator.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("honors an exact Last-Event-ID without replaying the same snapshot", async () => {
    vi.useFakeTimers();
    const aggregator = new FakeAggregator();
    aggregator.replay = { value: snapshot(), sequence: 7 };
    const response = handlePowerStreamRequest(
      request(undefined, { headers: { "Last-Event-ID": "main:7" } }),
      { config: config(), aggregator, connectionGate: new PowerStreamConnectionGate() }
    );
    const reader = response.body!.getReader();
    openStreams.push(reader);
    const first = await readUntil(reader, /retry: 5000/);
    expect(first).not.toContain("event: power");
    const heartbeat = readUntil(reader, /heartbeat/);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await heartbeat).toContain("heartbeat");
  });

  it.each([
    ["/api/v1/power/stream?serverId=../../private", 400, "INVALID_SERVER_ID"],
    ["/api/v1/power/stream?serverId=main&serverId=main", 400, "INVALID_QUERY"],
    ["/api/v1/power/stream?serverId=main&promql=secret", 400, "INVALID_QUERY"],
    ["/api/v1/power/stream?serverId=unknown", 404, "SERVER_NOT_FOUND"],
  ])("rejects invalid stream request %s", (path, status, code) => {
    const response = handlePowerStreamRequest(request(path), {
      config: config(),
      aggregator: new FakeAggregator(),
      connectionGate: new PowerStreamConnectionGate(),
    });
    expect(response.status).toBe(status);
    return expect(response.json()).resolves.toMatchObject({ error: { code } });
  });

  it("rejects malformed or cross-server Last-Event-ID values", async () => {
    for (const lastEventId of ["garbage", "other:2", "main:0", "main:-1"]) {
      const response = handlePowerStreamRequest(
        request(undefined, { headers: { "Last-Event-ID": lastEventId } }),
        { config: config(), aggregator: new FakeAggregator(), connectionGate: new PowerStreamConnectionGate() }
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "INVALID_LAST_EVENT_ID" },
      });
    }
  });

  it("fails closed while the deployment feature gate is disabled", async () => {
    const response = handlePowerStreamRequest(request(), {
      config: config({ powerStreamEnabled: false }),
      aggregator: new FakeAggregator(),
      connectionGate: new PowerStreamConnectionGate(),
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "STREAM_DISABLED" } });
  });

  it("enforces independent per-client and global active connection caps", async () => {
    const gate = new PowerStreamConnectionGate({ perClientLimit: 1, globalLimit: 2 });
    const trusted = config({ trustProxyHeaders: true });
    const first = handlePowerStreamRequest(
      request(undefined, { headers: { "x-forwarded-for": "192.0.2.1" } }),
      { config: trusted, aggregator: new FakeAggregator(), connectionGate: gate }
    );
    openStreams.push(first.body!.getReader());

    const sameClient = handlePowerStreamRequest(
      request(undefined, { headers: { "x-forwarded-for": "192.0.2.1" } }),
      { config: trusted, aggregator: new FakeAggregator(), connectionGate: gate }
    );
    expect(sameClient.status).toBe(429);

    const second = handlePowerStreamRequest(
      request(undefined, { headers: { "x-forwarded-for": "192.0.2.2" } }),
      { config: trusted, aggregator: new FakeAggregator(), connectionGate: gate }
    );
    openStreams.push(second.body!.getReader());
    const global = handlePowerStreamRequest(
      request(undefined, { headers: { "x-forwarded-for": "192.0.2.3" } }),
      { config: trusted, aggregator: new FakeAggregator(), connectionGate: gate }
    );
    expect(global.status).toBe(429);
    expect(global.headers.get("retry-after")).toBe("5");
  });

  it("returns a sanitized 503 and releases the gate when producer subscription fails", async () => {
    const gate = new PowerStreamConnectionGate({ perClientLimit: 1, globalLimit: 1 });
    const aggregator = new FakeAggregator();
    aggregator.shouldThrow = true;
    const failed = handlePowerStreamRequest(request(), {
      config: config(), aggregator, connectionGate: gate,
    });
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("private producer failure");

    aggregator.shouldThrow = false;
    const recovered = handlePowerStreamRequest(request(), {
      config: config(), aggregator, connectionGate: gate,
    });
    expect(recovered.status).toBe(200);
    openStreams.push(recovered.body!.getReader());
  });

  it("fails closed when an initial event exceeds the byte cap or violates the strict schema", async () => {
    const oversized = new FakeAggregator();
    oversized.replay = { value: snapshot(), sequence: 1 };
    const tooLarge = handlePowerStreamRequest(request(), {
      config: config(),
      aggregator: oversized,
      connectionGate: new PowerStreamConnectionGate(),
      maxEventBytes: 64,
    });
    expect(tooLarge.status).toBe(503);

    const invalid = new FakeAggregator();
    invalid.replay = {
      value: { ...snapshot(), privateSelector: "secret" } as unknown as PowerStreamSnapshot,
      sequence: 1,
    };
    const rejected = handlePowerStreamRequest(request(), {
      config: config(),
      aggregator: invalid,
      connectionGate: new PowerStreamConnectionGate(),
    });
    expect(rejected.status).toBe(503);
    expect(await rejected.text()).not.toContain("secret");
  });
});
