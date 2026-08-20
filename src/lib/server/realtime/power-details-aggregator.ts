import {
  powerDetailsStreamSnapshotSchema,
  type PowerDetailsStreamSnapshot,
} from "@/contracts/power-contracts";
import type { PowerDetailsProducer } from "./power-details-subscription";

export type { PowerDetailsProducerContext } from "./power-details-subscription";

export type PowerDetailsAggregatorState =
  | "idle"
  | "connecting"
  | "live"
  | "backing-off"
  | "stopping";

export type PowerDetailsProducerFactory = (
  serverId: string
) => PowerDetailsProducer;

export type PowerDetailsListener = (details: PowerDetailsStreamSnapshot) => void;
export type SequencedPowerDetailsListener = (
  details: PowerDetailsStreamSnapshot,
  sequence: number
) => void;

interface PowerDetailsAggregatorOptions {
  createProducer: PowerDetailsProducerFactory;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

interface Owner {
  controller: AbortController;
  running: Promise<void>;
}

interface ServerSlot {
  serverId: string;
  state: PowerDetailsAggregatorState;
  subscribers: Set<SequencedPowerDetailsListener>;
  latest: PowerDetailsStreamSnapshot | null;
  latestSignature: string | null;
  sequence: number;
  owner: Owner | null;
}

const DEFAULT_BASE_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;

/**
 * Process-local shared fan-out for slower generator/consumer detail polling.
 *
 * A stable slot owns at most one detail producer per server. A producer that
 * returns or rejects while subscribers remain is retried after bounded
 * exponential backoff rather than restarted synchronously, so a synchronous
 * factory throw or an immediate async rejection cannot recurse or hot-loop.
 */
export class PowerDetailsAggregator {
  private readonly slots = new Map<string, ServerSlot>();
  private readonly sequences = new Map<string, number>();
  private readonly createProducer: PowerDetailsProducerFactory;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(options: PowerDetailsAggregatorOptions) {
    this.createProducer = options.createProducer;
    this.baseBackoffMs = positiveInteger(
      options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS,
      "baseBackoffMs"
    );
    this.maxBackoffMs = positiveInteger(
      options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS,
      "maxBackoffMs"
    );
    if (this.maxBackoffMs < this.baseBackoffMs) {
      throw new Error("maxBackoffMs must be greater than or equal to baseBackoffMs");
    }
  }

  subscribe(serverId: string, listener: PowerDetailsListener): () => void {
    return this.subscribeSequenced(serverId, (details) => listener(details));
  }

  subscribeSequenced(
    serverId: string,
    listener: SequencedPowerDetailsListener
  ): () => void {
    let slot = this.slots.get(serverId);
    if (!slot) {
      slot = {
        serverId,
        state: "idle",
        subscribers: new Set(),
        latest: null,
        latestSignature: null,
        sequence: this.sequences.get(serverId) ?? 0,
        owner: null,
      };
      this.slots.set(serverId, slot);
    }

    slot.subscribers.add(listener);
    if (slot.latest) listener(slot.latest, slot.sequence);
    if (!slot.owner) this.startOwner(slot);

    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      slot!.subscribers.delete(listener);
      if (slot!.subscribers.size === 0 && slot!.owner) {
        slot!.state = "stopping";
        slot!.owner.controller.abort();
      } else if (slot!.subscribers.size === 0) {
        this.slots.delete(serverId);
      }
    };
  }

  shutdown(): void {
    for (const slot of this.slots.values()) {
      slot.subscribers.clear();
      slot.latest = null;
      slot.latestSignature = null;
      if (slot.owner) {
        slot.state = "stopping";
        slot.owner.controller.abort();
      }
    }
  }

  stateForTests(serverId: string): PowerDetailsAggregatorState {
    return this.slots.get(serverId)?.state ?? "idle";
  }

  private startOwner(slot: ServerSlot): void {
    const controller = new AbortController();
    const owner: Owner = {
      controller,
      running: Promise.resolve(),
    };
    slot.owner = owner;
    owner.running = this.runOwner(slot, owner);
  }

  private async runOwner(slot: ServerSlot, owner: Owner): Promise<void> {
    let backoffMs = this.baseBackoffMs;
    const { signal } = owner.controller;

    try {
      while (!signal.aborted && slot.subscribers.size > 0) {
        slot.state = "connecting";
        let emitted = false;
        const emit = (candidate: PowerDetailsStreamSnapshot) => {
          const details = powerDetailsStreamSnapshotSchema.parse(candidate);
          emitted = true;
          backoffMs = this.baseBackoffMs;
          const signature = detailsSignature(details);
          const changed = signature !== slot.latestSignature;
          slot.latest = details;
          slot.latestSignature = signature;
          slot.state = "live";
          if (!changed) return;
          slot.sequence += 1;
          this.sequences.set(slot.serverId, slot.sequence);
          for (const subscriber of [...slot.subscribers]) {
            try {
              subscriber(details, slot.sequence);
            } catch {
              // One subscriber cannot stop the shared producer.
            }
          }
        };

        try {
          const producer = this.createProducer(slot.serverId);
          await producer({ serverId: slot.serverId, signal, emit });
        } catch {
          // Detail producers degrade groups internally; an unexpected throw or
          // rejection simply ends this attempt. The state machine owns retry.
        }

        if (signal.aborted || slot.subscribers.size === 0) break;
        slot.state = "backing-off";
        await abortableDelay(backoffMs, signal);
        if (!emitted) {
          backoffMs = Math.min(backoffMs * 2, this.maxBackoffMs);
        }
      }
    } finally {
      if (slot.owner !== owner) return;
      slot.owner = null;
      if (slot.subscribers.size > 0) {
        this.startOwner(slot);
      } else {
        slot.state = "idle";
        slot.latest = null;
        slot.latestSignature = null;
        this.slots.delete(slot.serverId);
      }
    }
  }
}

/** Unchanged telemetry excludes observedAt, so timestamp-only drift is silent. */
function detailsSignature(details: PowerDetailsStreamSnapshot): string {
  return JSON.stringify({
    generators: details.generators,
    majorConsumers: details.majorConsumers,
  });
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

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
