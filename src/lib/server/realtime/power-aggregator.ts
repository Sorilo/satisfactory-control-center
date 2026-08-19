import {
  powerStreamSnapshotSchema,
  type PowerStreamSnapshot,
} from "@/contracts/power-contracts";

export type PowerAggregatorState =
  | "idle"
  | "connecting"
  | "live"
  | "backing-off"
  | "stopping";

export interface PowerProducerContext {
  serverId: string;
  signal: AbortSignal;
  emit(snapshot: PowerStreamSnapshot): void;
}

export type PowerProducer = (context: PowerProducerContext) => Promise<void>;
export type PowerProducerFactory = (serverId: string) => PowerProducer;
export type PowerSnapshotListener = (snapshot: PowerStreamSnapshot) => void;
export type SequencedPowerSnapshotListener = (
  snapshot: PowerStreamSnapshot,
  sequence: number
) => void;

interface PowerAggregatorOptions {
  createProducer: PowerProducerFactory;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

interface Owner {
  controller: AbortController;
  running: Promise<void>;
}

interface ServerSlot {
  serverId: string;
  state: PowerAggregatorState;
  subscribers: Set<SequencedPowerSnapshotListener>;
  latest: PowerStreamSnapshot | null;
  latestSignature: string | null;
  sequence: number;
  owner: Owner | null;
}

const DEFAULT_BASE_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;

/**
 * Process-local fan-out for normalized current power.
 *
 * A stable slot owns at most one producer for each server. The slot remains in
 * the map while an aborted producer winds down, so a subscriber arriving during
 * cleanup cannot start a competing upstream owner.
 */
export class PowerAggregator {
  private readonly slots = new Map<string, ServerSlot>();
  private readonly sequences = new Map<string, number>();
  private readonly createProducer: PowerProducerFactory;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(options: PowerAggregatorOptions) {
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

  subscribe(serverId: string, listener: PowerSnapshotListener): () => void {
    return this.subscribeSequenced(serverId, (snapshot) => listener(snapshot));
  }

  subscribeSequenced(
    serverId: string,
    listener: SequencedPowerSnapshotListener
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

  stateForTests(serverId: string): PowerAggregatorState {
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
        const emit = (candidate: PowerStreamSnapshot) => {
          const snapshot = powerStreamSnapshotSchema.parse(candidate);
          emitted = true;
          backoffMs = this.baseBackoffMs;
          const signature = telemetrySignature(snapshot);
          const changed = signature !== slot.latestSignature;
          slot.latest = snapshot;
          slot.latestSignature = signature;
          slot.state = "live";
          if (!changed) return;
          slot.sequence += 1;
          this.sequences.set(slot.serverId, slot.sequence);
          for (const subscriber of [...slot.subscribers]) {
            try {
              subscriber(snapshot, slot.sequence);
            } catch {
              // One public subscriber cannot stop the shared producer.
            }
          }
        };

        try {
          const producer = this.createProducer(slot.serverId);
          await producer({ serverId: slot.serverId, signal, emit });
        } catch {
          // Upstream details remain private; the state machine owns retry.
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

function telemetrySignature(snapshot: PowerStreamSnapshot): string {
  return JSON.stringify({
    topologyState: snapshot.topologyState,
    totals: snapshot.totals,
    circuits: snapshot.circuits,
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
