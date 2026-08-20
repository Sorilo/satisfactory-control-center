import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PowerGenerator,
  PowerMajorConsumer,
  PowerProvider,
} from "@/domain/power";
import { createPollingPowerDetailsProducer } from "./power-details-subscription";

const NOW = "2026-08-18T18:00:00.000Z";

const generator: PowerGenerator = {
  name: "Coal Generator",
  circuit: { state: "connected", id: "0" },
  fuelType: "coal",
  fuelInventory: { name: "Coal", amount: 50, capacity: 100 },
  productionCapacityMw: 75,
  loadPercent: 50,
  canStart: true,
  fuseTriggered: false,
};

const consumer: PowerMajorConsumer = {
  name: "Assembler Bank",
  circuit: { state: "connected", id: "0" },
  consumptionMw: 3,
  maximumConsumptionMw: 5,
  fuseTriggered: false,
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

afterEach(() => vi.useRealTimers());

describe("power details subscription producer", () => {
  it("defaults to a 30s cadence and polls again on the next interval", async () => {
    vi.useFakeTimers();
    const provider: PowerProvider = {
      getPower: vi.fn(),
      getGenerators: vi.fn(async () => [generator]),
      getMajorConsumers: vi.fn(async () => [consumer]),
    };
    const producer = createPollingPowerDetailsProducer(provider, {
      now: () => new Date(NOW),
    });
    const controller = new AbortController();
    const emit = vi.fn();
    const running = producer({
      serverId: "main",
      signal: controller.signal,
      emit,
    });
    await flush();
    expect(provider.getGenerators).toHaveBeenCalledTimes(1);
    expect(provider.getMajorConsumers).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(emit).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(provider.getGenerators).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledTimes(2);

    controller.abort();
    await expect(running).resolves.toBeUndefined();
  });

  it.each([
    ["below the floor", 14_999],
    ["above the ceiling", 120_001],
    ["zero", 0],
    ["non-integer", 15_000.5],
  ])("rejects an intervalMs %s", (_label, intervalMs) => {
    expect(() =>
      createPollingPowerDetailsProducer(
        { getPower: vi.fn() },
        { intervalMs }
      )
    ).toThrow(/intervalMs/);
  });

  it.each([15_000, 30_000, 120_000])(
    "accepts a bounded intervalMs of %i",
    (intervalMs) => {
      expect(() =>
        createPollingPowerDetailsProducer(
          { getPower: vi.fn() },
          { intervalMs }
        )
      ).not.toThrow();
    }
  );

  it("emits observedAt and both live detail groups", async () => {
    vi.useFakeTimers();
    const provider: PowerProvider = {
      getPower: vi.fn(),
      getGenerators: vi.fn(async () => [generator]),
      getMajorConsumers: vi.fn(async () => [consumer]),
    };
    const producer = createPollingPowerDetailsProducer(provider, {
      intervalMs: 15_000,
      now: () => new Date(NOW),
    });
    const emit = vi.fn();
    const controller = new AbortController();
    const running = producer({
      serverId: "main",
      signal: controller.signal,
      emit,
    });
    await flush();

    expect(emit).toHaveBeenCalledWith({
      observedAt: NOW,
      generators: { state: "live", items: [generator] },
      majorConsumers: { state: "live", items: [consumer] },
    });

    controller.abort();
    await expect(running).resolves.toBeUndefined();
  });

  it("degrades generator and consumer detail groups independently", async () => {
    vi.useFakeTimers();
    const provider: PowerProvider = {
      getPower: vi.fn(),
      getGenerators: vi.fn(async () => {
        throw new Error("private generator failure");
      }),
      getMajorConsumers: vi.fn(async () => [consumer]),
    };
    const producer = createPollingPowerDetailsProducer(provider, {
      intervalMs: 15_000,
      now: () => new Date(NOW),
    });
    const emit = vi.fn();
    const controller = new AbortController();
    const running = producer({
      serverId: "main",
      signal: controller.signal,
      emit,
    });
    await flush();

    expect(emit).toHaveBeenCalledWith({
      observedAt: NOW,
      generators: { state: "unavailable", items: [] },
      majorConsumers: { state: "live", items: [consumer] },
    });

    controller.abort();
    await expect(running).resolves.toBeUndefined();
  });

  it("degrades consumers while generators stay live", async () => {
    vi.useFakeTimers();
    const provider: PowerProvider = {
      getPower: vi.fn(),
      getGenerators: vi.fn(async () => [generator]),
      getMajorConsumers: vi.fn(async () => {
        throw new Error("private consumer failure");
      }),
    };
    const producer = createPollingPowerDetailsProducer(provider, {
      intervalMs: 15_000,
      now: () => new Date(NOW),
    });
    const emit = vi.fn();
    const controller = new AbortController();
    const running = producer({
      serverId: "main",
      signal: controller.signal,
      emit,
    });
    await flush();

    expect(emit).toHaveBeenCalledWith({
      observedAt: NOW,
      generators: { state: "live", items: [generator] },
      majorConsumers: { state: "unavailable", items: [] },
    });

    controller.abort();
    await expect(running).resolves.toBeUndefined();
  });

  it("rejects absent detail methods to unavailable groups", async () => {
    vi.useFakeTimers();
    const provider: PowerProvider = {
      getPower: vi.fn(async () => {
        throw new Error("unused");
      }),
    };
    const producer = createPollingPowerDetailsProducer(provider, {
      intervalMs: 15_000,
      now: () => new Date(NOW),
    });
    const emit = vi.fn();
    const controller = new AbortController();
    const running = producer({
      serverId: "main",
      signal: controller.signal,
      emit,
    });
    await flush();

    expect(emit).toHaveBeenCalledWith({
      observedAt: NOW,
      generators: { state: "unavailable", items: [] },
      majorConsumers: { state: "unavailable", items: [] },
    });

    controller.abort();
    await expect(running).resolves.toBeUndefined();
  });

  it("rejects an absent consumer method while generators stay live", async () => {
    vi.useFakeTimers();
    const provider: PowerProvider = {
      getPower: vi.fn(),
      getGenerators: vi.fn(async () => [generator]),
    };
    const producer = createPollingPowerDetailsProducer(provider, {
      intervalMs: 15_000,
      now: () => new Date(NOW),
    });
    const emit = vi.fn();
    const controller = new AbortController();
    const running = producer({
      serverId: "main",
      signal: controller.signal,
      emit,
    });
    await flush();

    expect(emit).toHaveBeenCalledWith({
      observedAt: NOW,
      generators: { state: "live", items: [generator] },
      majorConsumers: { state: "unavailable", items: [] },
    });

    controller.abort();
    await expect(running).resolves.toBeUndefined();
  });

  it("bounds each detail group to its strict normalized cap", async () => {
    vi.useFakeTimers();
    const oversizedGenerators = Array.from({ length: 101 }, (_, index) => ({
      ...generator,
      name: `Generator ${index}`,
    }));
    const provider: PowerProvider = {
      getPower: vi.fn(),
      getGenerators: vi.fn(async () => oversizedGenerators),
      getMajorConsumers: vi.fn(async () => [consumer]),
    };
    const producer = createPollingPowerDetailsProducer(provider, {
      intervalMs: 15_000,
      now: () => new Date(NOW),
    });
    const emit = vi.fn();
    const controller = new AbortController();
    const running = producer({
      serverId: "main",
      signal: controller.signal,
      emit,
    });
    await flush();

    expect(emit).toHaveBeenCalledWith({
      observedAt: NOW,
      generators: { state: "unavailable", items: [] },
      majorConsumers: { state: "live", items: [consumer] },
    });

    controller.abort();
    await expect(running).resolves.toBeUndefined();
  });

  it("does not schedule another poll after abort", async () => {
    vi.useFakeTimers();
    const provider: PowerProvider = {
      getPower: vi.fn(),
      getGenerators: vi.fn(async () => [generator]),
      getMajorConsumers: vi.fn(async () => [consumer]),
    };
    const producer = createPollingPowerDetailsProducer(provider, {
      intervalMs: 15_000,
      now: () => new Date(NOW),
    });
    const controller = new AbortController();
    const emit = vi.fn();
    const running = producer({
      serverId: "main",
      signal: controller.signal,
      emit,
    });
    await flush();
    expect(provider.getGenerators).toHaveBeenCalledTimes(1);

    controller.abort();
    await expect(running).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(provider.getGenerators).toHaveBeenCalledTimes(1);
    expect(provider.getMajorConsumers).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
