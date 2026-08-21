// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PowerEnvelope, PowerStreamSnapshot } from "@/contracts/power-contracts";
import { PowerDashboard } from "./power-dashboard";

function envelope(capacityMw = 100): PowerEnvelope {
  return {
    apiVersion: "v1",
    generatedAt: "2026-08-18T18:00:00.000Z",
    serverId: "main",
    freshness: {
      current: { state: "live", observedAt: "2026-08-18T18:00:00.000Z" },
      history: { state: "unavailable", observedAt: null },
    },
    data: {
      current: {
        topologyState: "available",
        totals: {
          capacityMw,
          consumptionMw: 80,
          reportedMaximumConsumptionMw: 90,
          headroomMw: capacityMw - 80,
          utilizationPercent: (80 / capacityMw) * 100,
          fuseTriggered: false,
        },
        circuits: [],
        generators: { state: "unavailable", items: [] },
        majorConsumers: { state: "unavailable", items: [] },
      },
      history: null,
    },
    unavailableSources: ["prometheus"],
  };
}

function streamSnapshot(capacityMw: number): PowerStreamSnapshot {
  return {
    observedAt: "2026-08-18T18:00:05.000Z",
    topologyState: "available",
    totals: {
      capacityMw,
      consumptionMw: 80,
      reportedMaximumConsumptionMw: 90,
      headroomMw: capacityMw - 80,
      utilizationPercent: (80 / capacityMw) * 100,
      fuseTriggered: false,
    },
    circuits: [],
  };
}

function envelopeWithHistory(): PowerEnvelope {
  const value = envelope();
  value.freshness.history = {
    state: "live",
    observedAt: "2026-08-18T18:00:00.000Z",
  };
  value.data.history = {
    coverage: {
      state: "complete",
      requestedRange: "1h",
      effectiveResolution: "1m",
      retentionHorizonDays: 15,
      oldestSampleAt: "2026-08-18T17:00:00.000Z",
      newestSampleAt: "2026-08-18T18:00:00.000Z",
    },
    series: [
      {
        key: "capacityMw",
        circuitId: "0",
        points: [
          { timestamp: "2026-08-18T17:00:00.000Z", value: 100 },
          { timestamp: "2026-08-18T18:00:00.000Z", value: 100 },
        ],
      },
    ],
    production: { state: "unavailable", reason: "source-not-collected" },
  };
  return value;
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback = listener as (event: MessageEvent) => void;
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }

  close() {
    this.closed = true;
  }

  open() {
    this.onopen?.(new Event("open"));
  }

  emitPower(value: unknown) {
    const event = new MessageEvent("power", { data: JSON.stringify(value) });
    for (const listener of this.listeners.get("power") ?? []) listener(event);
  }

  emitDetails(value: unknown) {
    const event = new MessageEvent("power-details", { data: JSON.stringify(value) });
    for (const listener of this.listeners.get("power-details") ?? []) listener(event);
  }

  emitRaw(type: string, data: string) {
    const event = new MessageEvent(type, { data });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  emitMessage(value: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(value) }));
  }

  fail() {
    this.onerror?.(new Event("error"));
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PowerDashboard realtime recovery", () => {
  it("applies strict power snapshots without replacing detail or history state", async () => {
    render(<PowerDashboard envelope={envelope()} dataMode="live" streamEnabled />);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe(
      "/api/v1/power/stream?serverId=main"
    );

    act(() => {
      FakeEventSource.instances[0]!.open();
      FakeEventSource.instances[0]!.emitPower(streamSnapshot(200));
    });

    expect(await screen.findByText("0.20 GW")).toBeInTheDocument();
    expect(screen.getByText(/generator details unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/power history unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole("status", { name: /power refresh status/i })).toHaveTextContent(
      /realtime live/i
    );
  });

  it("uses bounded reconnects then falls back to the curated HTTP route", async () => {
    vi.useFakeTimers();
    const refreshed = envelope(300);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(refreshed), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    render(<PowerDashboard envelope={envelope()} dataMode="live" streamEnabled />);

    act(() => FakeEventSource.instances[0]!.fail());
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(FakeEventSource.instances).toHaveLength(2);

    act(() => FakeEventSource.instances[1]!.fail());
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(FakeEventSource.instances).toHaveLength(3);

    await act(async () => {
      FakeEventSource.instances[2]!.fail();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/power?serverId=main&range=1h&resolution=auto",
      expect.objectContaining({ cache: "no-store" })
    );
    expect(screen.getByText("0.30 GW")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: /power refresh status/i })).toHaveTextContent(
      /polling fallback/i
    );
    expect(FakeEventSource.instances).toHaveLength(3);
  });

  it("merges power-details events into generators/consumers while preserving totals and circuits", async () => {
    render(<PowerDashboard envelope={envelope()} dataMode="live" streamEnabled />);

    act(() => {
      FakeEventSource.instances[0]!.open();
      FakeEventSource.instances[0]!.emitPower(streamSnapshot(200));
    });
    expect(await screen.findByText("0.20 GW")).toBeInTheDocument();

    act(() => {
      FakeEventSource.instances[0]!.emitDetails({
        observedAt: "2026-08-18T18:00:10.000Z",
        generators: {
          state: "live",
          items: [{
            name: "Coal Generator",
            circuit: { state: "connected", id: "0" },
            fuelType: "coal",
            fuelInventory: { name: "Coal", amount: 50, capacity: 100 },
            productionCapacityMw: 75,
            loadPercent: 50,
            canStart: true,
            fuseTriggered: false,
          }],
        },
        majorConsumers: {
          state: "live",
          items: [{
            name: "Assembler Bank",
            circuit: { state: "connected", id: "0" },
            consumptionMw: 3,
            maximumConsumptionMw: 5,
            fuseTriggered: false,
          }],
        },
      });
    });

    expect(await screen.findByText("Coal Generator")).toBeInTheDocument();
    expect(screen.getByText("Assembler Bank")).toBeInTheDocument();
    // Aggregate totals stay from the power event; details never clobber them.
    expect(screen.getByText("0.20 GW")).toBeInTheDocument();
    expect(screen.queryByText(/generator details unavailable/i)).not.toBeInTheDocument();
  });

  it("accepts a valid default message when an intermediary strips named-event metadata", async () => {
    render(<PowerDashboard envelope={envelope()} dataMode="live" streamEnabled />);
    const source = FakeEventSource.instances[0]!;

    act(() => source.emitMessage(streamSnapshot(200)));

    expect(await screen.findByText("0.20 GW")).toBeInTheDocument();
    expect(source.closed).toBe(false);
  });

  it("refreshes retained history in place without navigating away from the selected view", async () => {
    vi.useFakeTimers();
    const refreshed = envelopeWithHistory();
    refreshed.data.history!.series[0]!.points.push({
      timestamp: "2026-08-18T18:01:00.000Z",
      value: 101,
    });
    refreshed.data.history!.coverage.newestSampleAt = "2026-08-18T18:01:00.000Z";
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(refreshed), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    render(
      <PowerDashboard
        envelope={envelopeWithHistory()}
        dataMode="live"
        streamEnabled
        sourceIntervalSeconds={5}
      />
    );
    expect(screen.getByText(/2 points/i)).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(5_000));

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/power?serverId=main&range=1h&resolution=auto",
      expect.objectContaining({ cache: "no-store" })
    );
    expect(screen.getByText(/3 points/i)).toBeInTheDocument();
    expect(screen.getByText(/6:01:00 PM UTC/)).toBeInTheDocument();
    expect(screen.getByText(/History source current/i)).toBeInTheDocument();
  });

  it("ignores malformed power-details events without failing or closing the healthy stream", async () => {
    render(<PowerDashboard envelope={envelope()} dataMode="live" streamEnabled />);
    const source = FakeEventSource.instances[0]!;

    act(() => {
      source.open();
      source.emitPower(streamSnapshot(200));
    });
    expect(await screen.findByText("0.20 GW")).toBeInTheDocument();

    // Raw non-JSON detail payload: ignored, never treated as a stream error.
    act(() => source.emitRaw("power-details", "not-json{{"));
    expect(source.closed).toBe(false);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(screen.getByRole("status", { name: /power refresh status/i })).toHaveTextContent(
      /realtime live/i
    );
    expect(screen.getByText(/generator details unavailable/i)).toBeInTheDocument();

    // Schema-invalid JSON detail payload: also ignored, stream still healthy.
    act(() => {
      source.emitDetails({
        observedAt: 12345,
        generators: { state: "bogus", items: [] },
        majorConsumers: { state: "bogus", items: [] },
      });
    });
    expect(source.closed).toBe(false);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(screen.getByRole("status", { name: /power refresh status/i })).toHaveTextContent(
      /realtime live/i
    );
  });
});
