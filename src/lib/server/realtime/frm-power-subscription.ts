import { z } from "zod";
import {
  powerStreamSnapshotSchema,
  type PowerStreamSnapshot,
} from "@/contracts/power-contracts";
import type { PowerProvider } from "@/domain/power";
import { normalizeFrmPowerPayload } from "@/lib/server/adapters/frm/frm-power-adapter";
import type { PowerProducer } from "./power-aggregator";

const frmPowerSubscriptionMessageSchema = z
  .object({
    endpoint: z.literal("getPower"),
    data: z.unknown(),
  })
  .strict();

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const MIN_POLL_INTERVAL_MS = 1_000;
const MAX_POLL_INTERVAL_MS = 60_000;

/** Parse only the observed FRM getPower subscription envelope. */
export function parseFrmPowerSubscriptionMessage(
  raw: unknown,
  observedAt: string
): PowerStreamSnapshot {
  const message = frmPowerSubscriptionMessageSchema.parse(raw);
  return powerStreamSnapshotSchema.parse(
    normalizeFrmPowerPayload(message.data, observedAt)
  );
}

/**
 * Bounded alternate producer used until an evidence-bound FRM subscription
 * transport is available. Reconnect/backoff remains the aggregator's concern.
 */
export function createPollingPowerProducer(
  provider: PowerProvider,
  options: { intervalMs?: number } = {}
): PowerProducer {
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  if (
    !Number.isInteger(intervalMs) ||
    intervalMs < MIN_POLL_INTERVAL_MS ||
    intervalMs > MAX_POLL_INTERVAL_MS
  ) {
    throw new Error("intervalMs must be an integer from 1000 through 60000");
  }

  return async ({ signal, emit }) => {
    while (!signal.aborted) {
      const state = await provider.getPower();
      if (signal.aborted) return;
      emit(powerStreamSnapshotSchema.parse(state));
      await abortableDelay(intervalMs, signal);
    }
  };
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
