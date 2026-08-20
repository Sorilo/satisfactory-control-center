import {
  powerDetailsStreamSnapshotSchema,
  powerStreamSnapshotSchema,
  type PowerDetailsStreamSnapshot,
  type PowerStreamSnapshot,
} from "@/contracts/power-contracts";
import {
  isValidPublicServerId,
  parseRuntimeConfig,
  resolvePublicServer,
  type RuntimeConfig,
} from "@/lib/server/config/runtime-config";
import { createPowerProviders } from "@/lib/server/providers/provider-factory";
import { createPollingPowerProducer } from "@/lib/server/realtime/frm-power-subscription";
import { PowerAggregator } from "@/lib/server/realtime/power-aggregator";
import { PowerDetailsAggregator } from "@/lib/server/realtime/power-details-aggregator";
import { createPollingPowerDetailsProducer } from "@/lib/server/realtime/power-details-subscription";
import { getClientKey } from "@/lib/server/security/rate-limiter";

export const dynamic = "force-dynamic";

const HEARTBEAT_INTERVAL_MS = 15_000;
const RETRY_AFTER_MS = 5_000;
const DEFAULT_MAX_EVENT_BYTES = 64 * 1024;
const DEFAULT_PER_CLIENT_LIMIT = 3;
const DEFAULT_GLOBAL_LIMIT = 50;
const encoder = new TextEncoder();

export interface PowerStreamAggregatorPort {
  subscribeSequenced(
    serverId: string,
    listener: (snapshot: PowerStreamSnapshot, sequence: number) => void
  ): () => void;
}

export interface PowerDetailsStreamAggregatorPort {
  subscribeSequenced(
    serverId: string,
    listener: (details: PowerDetailsStreamSnapshot, sequence: number) => void
  ): () => void;
}

interface PowerStreamRouteDependencies {
  config: RuntimeConfig;
  aggregator: PowerStreamAggregatorPort;
  connectionGate: PowerStreamConnectionGate;
  detailAggregator?: PowerDetailsStreamAggregatorPort;
  heartbeatIntervalMs?: number;
  maxEventBytes?: number;
}

export class PowerStreamConnectionGate {
  private readonly perClientLimit: number;
  private readonly globalLimit: number;
  private readonly byClient = new Map<string, number>();
  private total = 0;

  constructor(
    options: { perClientLimit?: number; globalLimit?: number } = {}
  ) {
    this.perClientLimit = positiveInteger(
      options.perClientLimit ?? DEFAULT_PER_CLIENT_LIMIT,
      "perClientLimit"
    );
    this.globalLimit = positiveInteger(
      options.globalLimit ?? DEFAULT_GLOBAL_LIMIT,
      "globalLimit"
    );
  }

  acquire(clientKey: string): (() => void) | null {
    const clientTotal = this.byClient.get(clientKey) ?? 0;
    if (this.total >= this.globalLimit || clientTotal >= this.perClientLimit) {
      return null;
    }
    this.total += 1;
    this.byClient.set(clientKey, clientTotal + 1);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.total -= 1;
      const remaining = (this.byClient.get(clientKey) ?? 1) - 1;
      if (remaining <= 0) this.byClient.delete(clientKey);
      else this.byClient.set(clientKey, remaining);
    };
  }
}

const singletonAggregator = new PowerAggregator({
  createProducer: (serverId) => {
    const config = parseRuntimeConfig(process.env);
    if (!config.powerStreamEnabled) {
      return async () => {
        throw new Error("power stream disabled");
      };
    }
    const server = resolvePublicServer(config, serverId);
    const providers = createPowerProviders(config, server);
    return createPollingPowerProducer(providers.current);
  },
});

const singletonDetailAggregator = new PowerDetailsAggregator({
  createProducer: (serverId) => {
    const config = parseRuntimeConfig(process.env);
    if (!config.powerStreamEnabled) {
      return async () => {
        throw new Error("power stream disabled");
      };
    }
    const server = resolvePublicServer(config, serverId);
    const providers = createPowerProviders(config, server);
    return createPollingPowerDetailsProducer(providers.current);
  },
});

const singletonConnectionGate = new PowerStreamConnectionGate();

export function GET(request: Request): Response {
  let config: RuntimeConfig;
  try {
    config = parseRuntimeConfig(process.env);
  } catch {
    return errorResponse(503, "CONFIGURATION_UNAVAILABLE", "Service configuration unavailable.");
  }
  return handlePowerStreamRequest(request, {
    config,
    aggregator: singletonAggregator,
    detailAggregator: singletonDetailAggregator,
    connectionGate: singletonConnectionGate,
  });
}

export function handlePowerStreamRequest(
  request: Request,
  dependencies: PowerStreamRouteDependencies
): Response {
  const { config, aggregator, connectionGate, detailAggregator } = dependencies;
  if (!config.powerStreamEnabled) {
    return errorResponse(503, "STREAM_DISABLED", "Realtime stream is unavailable.");
  }

  const url = new URL(request.url);
  const keys = [...url.searchParams.keys()];
  const serverValues = url.searchParams.getAll("serverId");
  if (
    keys.length !== 1 ||
    keys[0] !== "serverId" ||
    serverValues.length !== 1
  ) {
    return errorResponse(400, "INVALID_QUERY", "Invalid stream query.");
  }

  const serverId = serverValues[0] ?? "";
  if (!isValidPublicServerId(serverId)) {
    return errorResponse(400, "INVALID_SERVER_ID", "Invalid server id.");
  }
  try {
    resolvePublicServer(config, serverId);
  } catch {
    return errorResponse(404, "SERVER_NOT_FOUND", "Server not found.");
  }

  const lastEventId = request.headers.get("last-event-id");
  if (lastEventId !== null && !isValidLastEventId(lastEventId, serverId)) {
    return errorResponse(400, "INVALID_LAST_EVENT_ID", "Invalid event id.");
  }

  const release = connectionGate.acquire(
    getClientKey(request, config.trustProxyHeaders)
  );
  if (!release) {
    return errorResponse(429, "STREAM_LIMITED", "Too many active streams.", {
      "Retry-After": String(RETRY_AFTER_MS / 1_000),
    });
  }

  const heartbeatIntervalMs = positiveInteger(
    dependencies.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
    "heartbeatIntervalMs"
  );
  const maxEventBytes = positiveInteger(
    dependencies.maxEventBytes ?? DEFAULT_MAX_EVENT_BYTES,
    "maxEventBytes"
  );

  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let unsubscribe: (() => void) | null = null;
  let unsubscribeDetails: (() => void) | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let pendingPowerFrame: Uint8Array | null = null;
  let pendingDetailsFrame: Uint8Array | null = null;
  let initialFailure = false;
  let cleaned = false;
  let detailChannelBroken = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    request.signal.removeEventListener("abort", onRequestAbort);
    unsubscribe?.();
    unsubscribeDetails?.();
    release();
  };

  const failStream = () => {
    initialFailure = true;
    if (streamController) {
      cleanup();
      try {
        streamController.error(new Error("power stream event unavailable"));
      } catch {
        // The reader may already have cancelled.
      }
    }
  };

  const enqueueFrame = (channel: "power" | "details", frame: Uint8Array) => {
    const controller = streamController;
    if (!controller || (controller.desiredSize ?? 0) <= 0) {
      if (channel === "power") pendingPowerFrame = frame;
      else pendingDetailsFrame = frame;
      return;
    }
    controller.enqueue(frame);
  };

  const flushPending = () => {
    const controller = streamController;
    if (!controller) return;
    if (pendingPowerFrame && (controller.desiredSize ?? 0) > 0) {
      const frame = pendingPowerFrame;
      pendingPowerFrame = null;
      controller.enqueue(frame);
    }
    if (pendingDetailsFrame && (controller.desiredSize ?? 0) > 0) {
      const frame = pendingDetailsFrame;
      pendingDetailsFrame = null;
      controller.enqueue(frame);
    }
  };

  const powerListener = (candidate: PowerStreamSnapshot, sequence: number) => {
    try {
      const snapshot = powerStreamSnapshotSchema.parse(candidate);
      const eventId = `${serverId}:${sequence}`;
      if (eventId === lastEventId) return;
      enqueueFrame("power", encodePowerEvent(eventId, snapshot, maxEventBytes));
    } catch {
      failStream();
    }
  };

  const detachDetails = () => {
    const releaseDetail = unsubscribeDetails;
    unsubscribeDetails = null;
    releaseDetail?.();
  };

  const detailListener = (
    candidate: PowerDetailsStreamSnapshot,
    sequence: number
  ) => {
    try {
      const details = powerDetailsStreamSnapshotSchema.parse(candidate);
      const eventId = `${serverId}:details:${sequence}`;
      if (eventId === lastEventId) return;
      enqueueFrame("details", encodeDetailEvent(eventId, details, maxEventBytes));
    } catch {
      // A malformed or oversized detail event must not tear down the accepted
      // power stream; detach this connection's detail channel instead.
      detailChannelBroken = true;
      detachDetails();
    }
  };

  try {
    unsubscribe = aggregator.subscribeSequenced(serverId, powerListener);
  } catch {
    cleanup();
    return errorResponse(503, "STREAM_UNAVAILABLE", "Realtime stream is unavailable.");
  }

  if (detailAggregator) {
    try {
      unsubscribeDetails = detailAggregator.subscribeSequenced(serverId, detailListener);
    } catch {
      unsubscribeDetails = null;
    }
    if (detailChannelBroken) detachDetails();
  }

  if (initialFailure) {
    cleanup();
    return errorResponse(503, "STREAM_UNAVAILABLE", "Realtime stream is unavailable.");
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      controller.enqueue(encoder.encode(`retry: ${RETRY_AFTER_MS}\n\n`));
      flushPending();
      heartbeatTimer = setInterval(() => {
        if (
          pendingPowerFrame ||
          pendingDetailsFrame ||
          (controller.desiredSize ?? 0) <= 0
        ) {
          return;
        }
        controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, heartbeatIntervalMs);
      request.signal.addEventListener("abort", onRequestAbort, { once: true });
      if (request.signal.aborted) onRequestAbort();
    },
    pull() {
      flushPending();
    },
    cancel() {
      cleanup();
    },
  });

  function onRequestAbort() {
    cleanup();
    try {
      streamController?.close();
    } catch {
      // The body may already be cancelled or errored.
    }
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function encodePowerEvent(
  eventId: string,
  snapshot: PowerStreamSnapshot,
  maxEventBytes: number
): Uint8Array {
  const frame = encoder.encode(
    `id: ${eventId}\nevent: power\ndata: ${JSON.stringify(snapshot)}\n\n`
  );
  if (frame.byteLength > maxEventBytes) {
    throw new Error("power stream event exceeds byte cap");
  }
  return frame;
}

function encodeDetailEvent(
  eventId: string,
  details: PowerDetailsStreamSnapshot,
  maxEventBytes: number
): Uint8Array {
  const frame = encoder.encode(
    `id: ${eventId}\nevent: power-details\ndata: ${JSON.stringify(details)}\n\n`
  );
  if (frame.byteLength > maxEventBytes) {
    throw new Error("power details stream event exceeds byte cap");
  }
  return frame;
}

function isValidLastEventId(value: string, serverId: string): boolean {
  const match = /^([a-z0-9][a-z0-9_-]{0,63}):(?:details:)?([1-9]\d*)$/.exec(value);
  return match?.[1] === serverId;
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  headers: HeadersInit = {}
): Response {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: { "Cache-Control": "no-store", ...headers },
    }
  );
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
