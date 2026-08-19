/**
 * Normalized domain models and provider ports for the Control Center.
 *
 * These types are the single source of truth for the "normalized overview"
 * concept. They deliberately contain no upstream field names, no private
 * location/inventory data, and no network types. Adapters (see
 * src/lib/server/adapters) translate raw upstream payloads into these models;
 * services (see src/lib/server/services) consume them through the ports below.
 */

export interface ServerSummary {
  online: boolean;
}

export interface SessionSummary {
  name: string;
  uptimeSeconds: number;
  paused: boolean;
}

export interface PlayersSummary {
  online: number;
  names: string[];
}

export interface PowerSummary {
  capacityMw: number;
  consumptionMw: number;
  headroomMw: number;
  utilizationPercent: number | null;
  fuseTriggered: boolean;
}

export interface FactorySummary {
  machineCount: number;
  producingCount: number;
  averageEfficiencyPercent: number | null;
}

export interface ProgressItemSummary {
  name: string;
  delivered: number;
  required: number;
}

export interface ProgressSummary {
  items: ProgressItemSummary[];
}

export interface OverviewSnapshot {
  observedAt: string;
  server: ServerSummary;
  session: SessionSummary | null;
  players: PlayersSummary;
  power: PowerSummary | null;
  factory: FactorySummary;
  progress: ProgressSummary | null;
}

/**
 * Read-only provider port implemented by the FRM live adapter and the mock
 * provider. Domain and services never import transport/schema details from
 * upstream.
 */
export interface FrmProvider {
  getOverview(): Promise<OverviewSnapshot>;
}
