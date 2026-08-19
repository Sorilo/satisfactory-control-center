import { afterEach, describe, expect, it, vi } from "vitest";
import type { PowerStreamSnapshot } from "@/contracts/power-contracts";
import {
  PowerAggregator,
  type PowerProducerContext,
} from "./power-aggregator";

function snapshot(observedAt: string, capacityMw = 100): PowerStreamSnapshot {
  return {
    observedAt,
    topologyState: "available",
    totals: {
      capacityMw,
      consumptionMw: 80,
      reportedMaximumConsumptionMw: 90,
      headroomMw: capacityMw - 80,
      utilizationPercent: (80 / capacityMw) * 100,
      fuseTriggered: false,
    },
    circuits: [{
      id: "7",
      capacityMw,
      consumptionMw: 80,
      reportedMaximumConsumptionMw: 90,
      headroomMw: capacityMw - 80,
      utilizationPercent: (80 / capacityMw) * 100,
      fuseTriggered: false,
      associatedCircuitCount: 1,
      battery: null,
    }],
  };
}

function untilAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

afterEach(() => {
  vi.useRealTimers();
});

describe("PowerAggregator", () => {
  it("owns one producer per server, replays the latest snapshot, and dedupes unchanged telemetry", async () => {
    const contexts: PowerProducerContext[] = [];
    const createProducer = vi.fn(() => async (context: PowerProducerContext) => {
      contexts.push(context);
      await untilAbort(context.signal);
    });
    const aggregator = new PowerAggregator({ createProducer });
    const first = vi.fn();
    const second = vi.fn();

    const unsubscribeFirst = aggregator.subscribe("main", first);
    const unsubscribeSecond = aggregator.subscribe("main", second);
    await flush();
    expect(createProducer).toHaveBeenCalledTimes(1);
    expect(contexts).toHaveLength(1);

    contexts[0]!.emit(snapshot("2026-08-18T18:00:00.000Z"));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    contexts[0]!.emit(snapshot("2026-08-18T18:00:05.000Z"));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    const replay = vi.fn();
    const unsubscribeReplay = aggregator.subscribe("main", replay);
    expect(replay).toHaveBeenCalledWith(snapshot("2026-08-18T18:00:05.000Z"));
    expect(createProducer).toHaveBeenCalledTimes(1);

    contexts[0]!.emit(snapshot("2026-08-18T18:00:10.000Z", 110));
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
    expect(replay).toHaveBeenCalledTimes(2);

    unsubscribeFirst();
    unsubscribeSecond();
    expect(contexts[0]!.signal.aborted).toBe(false);
    unsubscribeReplay();
    expect(contexts[0]!.signal.aborted).toBe(true);
    await flush();
    expect(aggregator.stateForTests("main")).toBe("idle");
  });

  it("reconnects with capped exponential backoff and returns live after an update", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const contexts: PowerProducerContext[] = [];
    const createProducer = vi.fn(() => async (context: PowerProducerContext) => {
      attempts += 1;
      contexts.push(context);
      if (attempts < 4) throw new Error(`private failure ${attempts}`);
      context.emit(snapshot("2026-08-18T18:00:00.000Z"));
      await untilAbort(context.signal);
    });
    const aggregator = new PowerAggregator({
      createProducer,
      baseBackoffMs: 100,
      maxBackoffMs: 400,
    });
    const listener = vi.fn();
    const unsubscribe = aggregator.subscribe("main", listener);

    await flush();
    expect(createProducer).toHaveBeenCalledTimes(1);
    expect(aggregator.stateForTests("main")).toBe("backing-off");

    await vi.advanceTimersByTimeAsync(100);
    expect(createProducer).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(createProducer).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(400);
    expect(createProducer).toHaveBeenCalledTimes(4);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(aggregator.stateForTests("main")).toBe("live");

    unsubscribe();
    await flush();
    expect(contexts.at(-1)!.signal.aborted).toBe(true);
  });

  it("cancels reconnect backoff when the last subscriber leaves", async () => {
    vi.useFakeTimers();
    const createProducer = vi.fn(() => async () => {
      throw new Error("offline");
    });
    const aggregator = new PowerAggregator({
      createProducer,
      baseBackoffMs: 100,
      maxBackoffMs: 400,
    });
    const unsubscribe = aggregator.subscribe("main", vi.fn());
    await flush();
    expect(aggregator.stateForTests("main")).toBe("backing-off");

    unsubscribe();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(createProducer).toHaveBeenCalledTimes(1);
    expect(aggregator.stateForTests("main")).toBe("idle");
  });

  it("shutdown aborts every server owner and clears all latest snapshots", async () => {
    const contexts: PowerProducerContext[] = [];
    const aggregator = new PowerAggregator({
      createProducer: () => async (context) => {
        contexts.push(context);
        context.emit(snapshot("2026-08-18T18:00:00.000Z"));
        await untilAbort(context.signal);
      },
    });
    aggregator.subscribe("main", vi.fn());
    aggregator.subscribe("backup", vi.fn());
    await flush();
    expect(contexts).toHaveLength(2);

    aggregator.shutdown();
    expect(contexts.every((context) => context.signal.aborted)).toBe(true);
    await flush();
    expect(aggregator.stateForTests("main")).toBe("idle");
    expect(aggregator.stateForTests("backup")).toBe("idle");
  });
});
