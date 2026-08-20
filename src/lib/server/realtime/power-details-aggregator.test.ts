import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PowerGenerator,
  PowerMajorConsumer,
} from "@/domain/power";
import {
  PowerDetailsAggregator,
  type PowerDetailsProducerContext,
} from "./power-details-aggregator";

const generator = (loadPercent = 50): PowerGenerator => ({
  name: "Coal Generator",
  circuit: { state: "connected", id: "0" },
  fuelType: "coal",
  fuelInventory: { name: "Coal", amount: 50, capacity: 100 },
  productionCapacityMw: 75,
  loadPercent,
  canStart: true,
  fuseTriggered: false,
});

const consumer: PowerMajorConsumer = {
  name: "Assembler Bank",
  circuit: { state: "connected", id: "0" },
  consumptionMw: 3,
  maximumConsumptionMw: 5,
  fuseTriggered: false,
};

function details(
  observedAt: string,
  generators: PowerGenerator[],
  majorConsumers: PowerMajorConsumer[] = [consumer]
) {
  return {
    observedAt,
    generators: { state: "live" as const, items: generators },
    majorConsumers: { state: "live" as const, items: majorConsumers },
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

afterEach(() => vi.useRealTimers());

describe("PowerDetailsAggregator", () => {
  it("owns one producer per server, replays latest, dedupes unchanged except observedAt, and sequences independently", async () => {
    const contexts: PowerDetailsProducerContext[] = [];
    const createProducer = vi.fn(
      () => async (context: PowerDetailsProducerContext) => {
        contexts.push(context);
        await untilAbort(context.signal);
      }
    );
    const aggregator = new PowerDetailsAggregator({ createProducer });
    const first = vi.fn();
    const second = vi.fn();

    const unsubscribeFirst = aggregator.subscribeSequenced("main", first);
    const unsubscribeSecond = aggregator.subscribeSequenced("main", second);
    await flush();
    expect(createProducer).toHaveBeenCalledTimes(1);
    expect(contexts).toHaveLength(1);

    contexts[0]!.emit(
      details("2026-08-18T18:00:00.000Z", [generator()])
    );
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first.mock.calls[0]?.[1]).toBe(1);
    expect(second.mock.calls[0]?.[1]).toBe(1);

    // Same detail content, only observedAt differs: not re-emitted, sequence unchanged.
    contexts[0]!.emit(
      details("2026-08-18T18:00:05.000Z", [generator()])
    );
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    const replay = vi.fn();
    const unsubscribeReplay = aggregator.subscribeSequenced("main", replay);
    expect(replay).toHaveBeenCalledTimes(1);
    expect(replay.mock.calls[0]?.[0]).toEqual(
      details("2026-08-18T18:00:05.000Z", [generator()])
    );
    expect(replay.mock.calls[0]?.[1]).toBe(1);
    expect(createProducer).toHaveBeenCalledTimes(1);

    // Changed content advances the sequence.
    contexts[0]!.emit(
      details("2026-08-18T18:00:10.000Z", [generator(80)])
    );
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
    expect(replay).toHaveBeenCalledTimes(2);
    expect(first.mock.calls[1]?.[1]).toBe(2);

    unsubscribeFirst();
    unsubscribeSecond();
    expect(contexts[0]!.signal.aborted).toBe(false);
    unsubscribeReplay();
    expect(contexts[0]!.signal.aborted).toBe(true);
    await flush();
    expect(aggregator.stateForTests("main")).toBe("idle");
  });

  it("aborts the shared producer when the last subscriber leaves", async () => {
    const contexts: PowerDetailsProducerContext[] = [];
    const aggregator = new PowerDetailsAggregator({
      createProducer: () => async (context) => {
        contexts.push(context);
        await untilAbort(context.signal);
      },
    });
    const unsubscribeA = aggregator.subscribe("main", vi.fn());
    const unsubscribeB = aggregator.subscribe("main", vi.fn());
    await flush();
    expect(contexts).toHaveLength(1);

    unsubscribeA();
    expect(contexts[0]!.signal.aborted).toBe(false);
    unsubscribeB();
    expect(contexts[0]!.signal.aborted).toBe(true);
    await flush();
    expect(aggregator.stateForTests("main")).toBe("idle");
  });

  it("shutdown aborts every server owner and clears latest details", async () => {
    const contexts: PowerDetailsProducerContext[] = [];
    const aggregator = new PowerDetailsAggregator({
      createProducer: () => async (context) => {
        contexts.push(context);
        context.emit(details("2026-08-18T18:00:00.000Z", [generator()]));
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

  it("does not recurse when createProducer throws synchronously and retries with bounded exponential backoff", async () => {
    vi.useFakeTimers();
    const createProducer = vi.fn(() => {
      throw new Error("synchronous producer failure");
    });
    const aggregator = new PowerDetailsAggregator({
      createProducer,
      baseBackoffMs: 100,
      maxBackoffMs: 400,
    });

    let unsubscribe: (() => void) | undefined;
    expect(() => {
      unsubscribe = aggregator.subscribe("main", vi.fn());
    }).not.toThrow();
    expect(createProducer).toHaveBeenCalledTimes(1);
    expect(aggregator.stateForTests("main")).toBe("backing-off");

    // Advancing zero time must not create another producer: no immediate recurse.
    await vi.advanceTimersByTimeAsync(0);
    expect(createProducer).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(createProducer).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(createProducer).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(400);
    expect(createProducer).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(400);
    expect(createProducer).toHaveBeenCalledTimes(5);

    unsubscribe?.();
    await flush();
    expect(aggregator.stateForTests("main")).toBe("idle");
  });

  it("backs off instead of spinning after an async producer rejection", async () => {
    vi.useFakeTimers();
    const createProducer = vi.fn(() => async () => {
      throw new Error("offline");
    });
    const aggregator = new PowerDetailsAggregator({
      createProducer,
      baseBackoffMs: 100,
      maxBackoffMs: 400,
    });
    const unsubscribe = aggregator.subscribe("main", vi.fn());
    await flush();
    expect(createProducer).toHaveBeenCalledTimes(1);
    expect(aggregator.stateForTests("main")).toBe("backing-off");

    await vi.advanceTimersByTimeAsync(0);
    expect(createProducer).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(createProducer).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(createProducer).toHaveBeenCalledTimes(3);

    unsubscribe();
    await flush();
    expect(aggregator.stateForTests("main")).toBe("idle");
  });

  it("cancels pending reconnect backoff when the last subscriber leaves", async () => {
    vi.useFakeTimers();
    const createProducer = vi.fn(() => async () => {
      throw new Error("offline");
    });
    const aggregator = new PowerDetailsAggregator({
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

  it("recovers and emits details after failures within capped backoff", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const contexts: PowerDetailsProducerContext[] = [];
    const createProducer = vi.fn(
      () => async (context: PowerDetailsProducerContext) => {
        attempts += 1;
        contexts.push(context);
        if (attempts < 4) throw new Error(`private failure ${attempts}`);
        context.emit(details("2026-08-18T18:00:00.000Z", [generator()]));
        await untilAbort(context.signal);
      }
    );
    const aggregator = new PowerDetailsAggregator({
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
});
