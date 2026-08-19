import { afterEach, describe, expect, it, vi } from "vitest";
import liveFixture from "../../../../docs/fixtures/slice2-task0/frm-get-power-live.json";
import type { PowerCurrentState, PowerProvider } from "@/domain/power";
import {
  createPollingPowerProducer,
  parseFrmPowerSubscriptionMessage,
} from "./frm-power-subscription";

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

afterEach(() => vi.useRealTimers());

describe("FRM power subscription boundary", () => {
  it("accepts only getPower subscription messages and reuses normalized current semantics", () => {
    const snapshot = parseFrmPowerSubscriptionMessage(
      { endpoint: "getPower", data: liveFixture },
      "2026-08-18T18:00:00.000Z"
    );
    expect(snapshot).toMatchObject({
      observedAt: "2026-08-18T18:00:00.000Z",
      topologyState: "available",
      totals: {
        capacityMw: 20,
        consumptionMw: 5,
        reportedMaximumConsumptionMw: 5,
      },
      circuits: [{ id: "0" }],
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /PowerProduction|PowerConsumed|endpoint|private|session_name|url/i
    );
  });

  it.each([
    { endpoint: "getGenerators", data: liveFixture },
    { endpoint: "getPower", data: { private: true } },
    { endpoint: "getPower", data: [{ ...liveFixture[0], PowerCapacity: null }] },
    { endpoint: "getPower", data: liveFixture, privateSession: "secret" },
    "not-an-object",
  ])("rejects malformed or non-power messages", (message) => {
    expect(() =>
      parseFrmPowerSubscriptionMessage(message, "2026-08-18T18:00:00.000Z")
    ).toThrow();
  });

  it("polls one normalized provider until aborted without scheduling another read", async () => {
    vi.useFakeTimers();
    const provider: PowerProvider = {
      getPower: vi.fn(async (): Promise<PowerCurrentState> => ({
        topologyState: "no-circuits",
        observedAt: "2026-08-18T18:00:00.000Z",
        totals: {
          capacityMw: 0,
          consumptionMw: 0,
          reportedMaximumConsumptionMw: 0,
          headroomMw: 0,
          utilizationPercent: null,
          fuseTriggered: false,
        },
        circuits: [],
      })),
    };
    const producer = createPollingPowerProducer(provider, { intervalMs: 5_000 });
    const controller = new AbortController();
    const emit = vi.fn();
    const running = producer({ serverId: "main", signal: controller.signal, emit });
    await flush();
    expect(provider.getPower).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(provider.getPower).toHaveBeenCalledTimes(2);
    controller.abort();
    await expect(running).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(provider.getPower).toHaveBeenCalledTimes(2);
  });

  it("propagates provider failure so the aggregator owns reconnect policy", async () => {
    const provider: PowerProvider = {
      getPower: vi.fn(async () => {
        throw new Error("private upstream failure");
      }),
    };
    const producer = createPollingPowerProducer(provider);
    const controller = new AbortController();
    await expect(
      producer({ serverId: "main", signal: controller.signal, emit: vi.fn() })
    ).rejects.toThrow("private upstream failure");
  });
});
