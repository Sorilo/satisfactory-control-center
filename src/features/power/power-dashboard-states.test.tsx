// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PowerEnvelope } from "@/contracts/power-contracts";
import { PowerDashboard, PowerDashboardLoading } from "./power-dashboard";

afterEach(cleanup);

function envelope(): PowerEnvelope {
  return {
    apiVersion: "v1",
    generatedAt: "2026-08-18T18:00:00.000Z",
    serverId: "main",
    freshness: {
      current: { state: "live", observedAt: "2026-08-18T18:00:00.000Z" },
      history: { state: "live", observedAt: "2026-08-18T18:00:00.000Z" },
    },
    data: {
      current: {
        topologyState: "available",
        totals: {
          capacityMw: 100,
          consumptionMw: 80,
          reportedMaximumConsumptionMw: 90,
          headroomMw: 20,
          utilizationPercent: 80,
          fuseTriggered: false,
        },
        circuits: [{
          id: "7",
          capacityMw: 100,
          consumptionMw: 80,
          reportedMaximumConsumptionMw: 90,
          headroomMw: 20,
          utilizationPercent: 80,
          fuseTriggered: false,
          associatedCircuitCount: 1,
          battery: {
            chargePercent: 75,
            netFlowMw: 10,
            secondsToEmpty: null,
            secondsToFull: 3600,
          },
        }],
        generators: { state: "unavailable", items: [] },
        majorConsumers: { state: "unavailable", items: [] },
      },
      history: {
        coverage: {
          state: "complete",
          requestedRange: "1h",
          effectiveResolution: "1m",
          retentionHorizonDays: 15,
          oldestSampleAt: "2026-08-18T17:00:00.000Z",
          newestSampleAt: "2026-08-18T18:00:00.000Z",
        },
        series: [{
          key: "capacityMw",
          circuitId: "7",
          points: [
            { timestamp: "2026-08-18T17:00:00.000Z", value: 95 },
            { timestamp: "2026-08-18T18:00:00.000Z", value: 100 },
          ],
        }],
        production: { state: "unavailable", reason: "source-not-collected" },
      },
    },
    unavailableSources: [],
  };
}

describe("PowerDashboard state matrix", () => {
  it("renders an accessible loading state", () => {
    render(<PowerDashboardLoading />);
    expect(screen.getByRole("status", { name: /loading power telemetry/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /loading power grid/i })).toBeInTheDocument();
  });

  it("renders zero capacity as a valid live state with undefined utilization", () => {
    const value = envelope();
    value.data.current!.totals = {
      capacityMw: 0,
      consumptionMw: 0,
      reportedMaximumConsumptionMw: 0,
      headroomMw: 0,
      utilizationPercent: null,
      fuseTriggered: false,
    };
    value.data.current!.circuits[0] = {
      ...value.data.current!.circuits[0]!,
      capacityMw: 0,
      consumptionMw: 0,
      reportedMaximumConsumptionMw: 0,
      headroomMw: 0,
      utilizationPercent: null,
      battery: null,
    };
    render(<PowerDashboard envelope={value} dataMode="live" />);
    const kpis = within(screen.getByRole("region", { name: /power key performance indicators/i }));
    expect(kpis.getAllByText("0.00 GW")).toHaveLength(4);
    expect(kpis.getByText("Reported maximum demand")).toBeInTheDocument();
    expect(kpis.queryByText(/corrected source maximum/i)).not.toBeInTheDocument();
    const utilization = kpis.getByText("Utilization").closest("article");
    expect(utilization).not.toBeNull();
    expect(within(utilization!).getByText("—")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("makes negative headroom, overload, and a triggered fuse explicit", () => {
    const value = envelope();
    value.data.current!.totals = {
      capacityMw: 100,
      consumptionMw: 120,
      reportedMaximumConsumptionMw: 130,
      headroomMw: -20,
      utilizationPercent: 120,
      fuseTriggered: true,
    };
    value.data.current!.circuits[0] = {
      ...value.data.current!.circuits[0]!,
      consumptionMw: 120,
      reportedMaximumConsumptionMw: 130,
      headroomMw: -20,
      utilizationPercent: 120,
      fuseTriggered: true,
    };
    render(<PowerDashboard envelope={value} dataMode="live" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/grid overload/i);
    expect(alert).toHaveTextContent(/fuse triggered/i);
    expect(screen.getByText("-0.02 GW")).toBeInTheDocument();
    expect(screen.getByText("Tripped")).toBeInTheDocument();
  });

  it("distinguishes a fuse-only alert from overload", () => {
    const value = envelope();
    value.data.current!.totals.fuseTriggered = true;
    value.data.current!.circuits[0] = {
      ...value.data.current!.circuits[0]!,
      fuseTriggered: true,
    };
    render(<PowerDashboard envelope={value} dataMode="live" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/fuse triggered/i);
    expect(alert).not.toHaveTextContent(/grid overload|demand exceeds/i);
  });

  it("labels battery presence and absence without implying zero charge", () => {
    const value = envelope();
    value.data.current!.circuits.push({
      ...value.data.current!.circuits[0]!,
      id: "8",
      battery: null,
    });
    render(<PowerDashboard envelope={value} dataMode="live" />);
    const table = screen.getByRole("table", { name: /current power circuits/i });
    expect(within(within(table).getByRole("row", { name: /^7 / })).getByText(/75%/)).toBeInTheDocument();
    expect(within(within(table).getByRole("row", { name: /^8 / })).getByText(/not reported/i)).toBeInTheDocument();
  });

  it("renders live optional generator and major-consumer details when supplied", () => {
    const value = envelope();
    value.data.current!.generators = {
      state: "live",
      items: [{
        name: "Coal Generator 1",
        fuelType: "coal",
        productionCapacityMw: 75,
        loadPercent: 80,
        canStart: true,
      }],
    };
    value.data.current!.majorConsumers = {
      state: "live",
      items: [{
        name: "Aluminum Works",
        circuitId: "7",
        consumptionMw: 42,
        maximumConsumptionMw: 50,
      }],
    };
    render(<PowerDashboard envelope={value} dataMode="live" />);
    expect(screen.getByRole("heading", { name: "Generator details" })).toBeInTheDocument();
    expect(screen.getByText("Coal Generator 1")).toBeInTheDocument();
    expect(screen.getByText(/^coal\s*·/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Major consumers" })).toBeInTheDocument();
    expect(screen.getByText("Aluminum Works")).toBeInTheDocument();
    expect(screen.queryByText(/power production/i)).not.toBeInTheDocument();
  });

  it("pairs complete history charts with a textual series summary", () => {
    render(<PowerDashboard envelope={envelope()} dataMode="live" />);
    expect(screen.getByText(/complete retained coverage/i)).toBeInTheDocument();
    const summary = screen.getByRole("table", { name: /power history series summary/i });
    expect(within(summary).getByRole("row", { name: /capacity.*circuit 7.*100 mw.*2 samples/i })).toBeInTheDocument();
  });

  it("keeps a valid one-point history series distinct from empty history", () => {
    const value = envelope();
    value.data.history!.series[0]!.points = [
      { timestamp: "2026-08-18T18:00:00.000Z", value: 100 },
    ];
    render(<PowerDashboard envelope={value} dataMode="live" />);
    expect(screen.getByRole("heading", { name: /one retained sample/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /no retained samples/i })).not.toBeInTheDocument();
    const summary = screen.getByRole("table", { name: /power history series summary/i });
    expect(within(summary).getByRole("row", { name: /capacity.*circuit 7.*100 mw.*1 sample/i })).toBeInTheDocument();
  });

  it("discloses successful empty history and unsupported production", () => {
    const value = envelope();
    value.data.history!.coverage = {
      ...value.data.history!.coverage,
      state: "empty",
      oldestSampleAt: null,
      newestSampleAt: null,
    };
    value.data.history!.series = [];
    value.freshness.history = { state: "live", observedAt: null };
    render(<PowerDashboard envelope={value} dataMode="live" />);
    expect(screen.getByText(/no retained samples in this range/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No retained samples" })).toBeInTheDocument();
    expect(screen.getByText(/historical production is not collected/i)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /power history trend/i })).not.toBeInTheDocument();
  });
});
