import { z } from "zod";
import {
  powerGeneratorSchema,
  powerMajorConsumerSchema,
  type PowerDetailsStreamSnapshot,
} from "@/contracts/power-contracts";
import type { PowerProvider } from "@/domain/power";

const MAX_GENERATORS = 100;
const MAX_MAJOR_CONSUMERS = 10;

export interface PowerDetailGroup<T> {
  state: "live" | "unavailable";
  items: T[];
}

export interface PowerDetailsProducerContext {
  serverId: string;
  signal: AbortSignal;
  emit(details: PowerDetailsStreamSnapshot): void;
}

export type PowerDetailsProducer = (
  context: PowerDetailsProducerContext
) => Promise<void>;

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const MIN_POLL_INTERVAL_MS = 15_000;
const MAX_POLL_INTERVAL_MS = 120_000;

/**
 * Bounded, slower polling producer for generator and major-consumer details.
 *
 * Each cadence reads both detail groups through `Promise.allSettled` so one
 * source's failure or absent method degrades only its own group. Each group is
 * validated against the shared public contract item schema; a group that
 * overflows its bound becomes `unavailable` rather than being truncated.
 */
export function createPollingPowerDetailsProducer(
  provider: PowerProvider,
  options: { intervalMs?: number; now?: () => Date } = {}
): PowerDetailsProducer {
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  if (
    !Number.isInteger(intervalMs) ||
    intervalMs < MIN_POLL_INTERVAL_MS ||
    intervalMs > MAX_POLL_INTERVAL_MS
  ) {
    throw new Error(
      `intervalMs must be an integer from ${MIN_POLL_INTERVAL_MS} through ${MAX_POLL_INTERVAL_MS}`
    );
  }
  const now = options.now ?? (() => new Date());

  return async ({ signal, emit }) => {
    while (!signal.aborted) {
      const observedAt = now().toISOString();
      const [generatorResult, consumerResult] = await Promise.allSettled([
        provider.getGenerators
          ? provider.getGenerators()
          : Promise.reject(new Error("generator details unavailable")),
        provider.getMajorConsumers
          ? provider.getMajorConsumers()
          : Promise.reject(new Error("major consumer details unavailable")),
      ]);
      if (signal.aborted) return;
      emit({
        observedAt,
        generators: detailGroup(
          generatorResult,
          z.array(powerGeneratorSchema).max(MAX_GENERATORS)
        ),
        majorConsumers: detailGroup(
          consumerResult,
          z.array(powerMajorConsumerSchema).max(MAX_MAJOR_CONSUMERS)
        ),
      });
      await abortableDelay(intervalMs, signal);
    }
  };
}

function detailGroup<T>(
  result: PromiseSettledResult<unknown>,
  itemsSchema: z.ZodType<T[]>
): PowerDetailGroup<T> {
  if (result.status === "rejected") return { state: "unavailable", items: [] };
  const parsed = itemsSchema.safeParse(result.value);
  if (!parsed.success) return { state: "unavailable", items: [] };
  return { state: "live", items: parsed.data };
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });

    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}
