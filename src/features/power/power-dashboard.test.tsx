// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PowerEnvelope } from "@/contracts/power-contracts";
import { buildChartSeries, PowerDashboard } from "./power-dashboard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function sample(): PowerEnvelope {
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
        totals: { capacityMw: 5000, consumptionMw: 3100, reportedMaximumConsumptionMw: 3400, headroomMw: 1900, utilizationPercent: 62, fuseTriggered: false },
        circuits: [{
          id: "7", capacityMw: 5000, consumptionMw: 3100, reportedMaximumConsumptionMw: 3400,
          headroomMw: 1900, utilizationPercent: 62, fuseTriggered: false, associatedCircuitCount: 2,
          battery: { chargePercent: 75, netFlowMw: 100, secondsToEmpty: null, secondsToFull: 3600 },
        }],
        generators: { state: "unavailable", items: [] },
        majorConsumers: { state: "unavailable", items: [] },
      },
      history: {
        coverage: { state: "partial", requestedRange: "7d", effectiveResolution: "15m", retentionHorizonDays: 15, oldestSampleAt: "2026-08-15T18:00:00.000Z", newestSampleAt: "2026-08-18T18:00:00.000Z" },
        series: [
          { key: "capacityMw", circuitId: "7", points: [{ timestamp: "2026-08-18T17:00:00.000Z", value: 4800 }, { timestamp: "2026-08-18T18:00:00.000Z", value: 5000 }] },
          { key: "consumptionMw", circuitId: "7", points: [{ timestamp: "2026-08-18T17:00:00.000Z", value: 3000 }, { timestamp: "2026-08-18T18:00:00.000Z", value: 3100 }] },
          { key: "correctedMaximumConsumptionMw", circuitId: "7", points: [{ timestamp: "2026-08-18T17:00:00.000Z", value: 3300 }, { timestamp: "2026-08-18T18:00:00.000Z", value: 3400 }] },
        ],
        production: { state: "unavailable", reason: "source-not-collected" },
      },
    },
    unavailableSources: [],
  };
}

describe("PowerDashboard", () => {
  it("renders current capacity semantics, history, and explicit detail limits", () => {
    render(<PowerDashboard envelope={sample()} dataMode="live" />);
    expect(screen.getByRole("heading", { name: "Power grid" })).toBeInTheDocument();
    const kpis = within(screen.getByRole("region", { name: /power key performance indicators/i }));
    expect(kpis.getByText("5.00 GW")).toBeInTheDocument();
    expect(kpis.getByText("3.10 GW")).toBeInTheDocument();
    expect(kpis.getByText("1.90 GW")).toBeInTheDocument();
    expect(kpis.getByText("62.0%")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /power history trend/i })).toBeInTheDocument();
    expect(screen.getByText(/partial retained coverage/i)).toBeInTheDocument();
    expect(screen.getByText(/generator details unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/major-consumer details unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/historical production is not collected/i)).toBeInTheDocument();
    expect(screen.queryByText(/power production/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/session_name|private-url|promql/i);
  });

  it("keeps retained history visible when current FRM data is unavailable", () => {
    const value = sample();
    value.data.current = null;
    value.freshness.current = { state: "unavailable", observedAt: null };
    value.unavailableSources = ["frm"];
    render(<PowerDashboard envelope={value} dataMode="live" />);
    expect(screen.getByText(/current power unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /power history trend/i })).toBeInTheDocument();
  });

  it("keeps current data visible when history is unavailable", () => {
    const value = sample();
    value.data.history = null;
    value.freshness.history = { state: "unavailable", observedAt: null };
    value.unavailableSources = ["prometheus"];
    render(<PowerDashboard envelope={value} dataMode="live" />);
    expect(screen.getByText("5.00 GW")).toBeInTheDocument();
    expect(screen.getByText(/power history unavailable/i)).toBeInTheDocument();
  });

  it("distinguishes a valid no-circuits world from source failure", () => {
    const value = sample();
    value.data.current!.topologyState = "no-circuits";
    value.data.current!.circuits = [];
    render(<PowerDashboard envelope={value} dataMode="mock" />);
    expect(screen.getByText(/no power circuits reported/i)).toBeInTheDocument();
    expect(screen.queryByText(/current power unavailable/i)).not.toBeInTheDocument();
  });

  it("renders a schema-valid large retained history without overflowing function arguments", () => {
    const value = sample();
    const baseTime = Date.parse("2026-08-03T18:00:00.000Z");
    const points = Array.from({ length: 2_000 }, (_, index) => ({
      timestamp: new Date(baseTime + index * 60_000).toISOString(),
      value: 3_000 + (index % 100),
    }));
    value.data.history!.series = Array.from({ length: 70 }, (_, index) => ({
      key: index % 2 === 0 ? "capacityMw" as const : "consumptionMw" as const,
      circuitId: String(index + 1),
      points,
    }));

    expect(() => render(<PowerDashboard envelope={value} dataMode="live" />)).not.toThrow();
    expect(screen.getByRole("group", { name: /power history trend/i })).toBeInTheDocument();
  });

  it("derives headroom and utilization client-side in the chart tooltip with clean MW/percent formatting", () => {
    const { container } = render(<PowerDashboard envelope={sample()} dataMode="live" />);
    const slider = screen.getByRole("slider", { name: /scrub telemetry timeline/i });
    slider.focus();
    fireEvent.keyDown(slider, { key: "End" });

    const tooltip = container.querySelector(".ttsc__tooltip");
    expect(tooltip).not.toBeNull();
    expect(tooltip).toHaveTextContent("Capacity · Circuit 7");
    expect(tooltip).toHaveTextContent("5,000 MW");
    expect(tooltip).toHaveTextContent("Consumption · Circuit 7");
    expect(tooltip).toHaveTextContent("3,100 MW");
    expect(tooltip).toHaveTextContent("Maximum demand · Circuit 7");
    expect(tooltip).toHaveTextContent("3,400 MW");
    expect(tooltip).toHaveTextContent("Headroom · Circuit 7");
    expect(tooltip).toHaveTextContent("1,900 MW");
    expect(tooltip).toHaveTextContent("Utilization · Circuit 7");
    expect(tooltip).toHaveTextContent("62.0%");
  });

  it("buildChartSeries derives headroom/utilization only at exact intersections with exact sampling", () => {
    const series = buildChartSeries([
      {
        key: "capacityMw",
        circuitId: "7",
        points: [
          { timestamp: "2026-08-18T17:00:00.000Z", value: 100 },
          { timestamp: "2026-08-18T18:00:00.000Z", value: 200 },
        ],
      },
      {
        key: "consumptionMw",
        circuitId: "7",
        points: [
          { timestamp: "2026-08-18T17:30:00.000Z", value: 60 },
          { timestamp: "2026-08-18T18:00:00.000Z", value: 80 },
        ],
      },
    ]);

    const headroom = series.find((item) => item.id === "7:headroomMw");
    expect(headroom).toBeDefined();
    expect(headroom!.hidden).toBe(true);
    expect(headroom!.sampleMode).toBe("exact");
    // 17:00 capacity has no consumption pair and 17:30 consumption has no
    // capacity pair; only the shared 18:00 timestamp survives.
    expect(headroom!.points.map((point) => point.timestamp)).toEqual([
      Date.parse("2026-08-18T18:00:00.000Z"),
    ]);
    expect(headroom!.points[0]!.value).toBe(120);

    const utilization = series.find((item) => item.id === "7:utilizationPercent");
    expect(utilization).toBeDefined();
    expect(utilization!.hidden).toBe(true);
    expect(utilization!.sampleMode).toBe("exact");
    expect(utilization!.points[0]!.value).toBe(40);
  });

  it("memoizes chart series so live current updates do not re-parse history timestamps", () => {
    const value = sample();
    const { rerender } = render(<PowerDashboard envelope={value} dataMode="live" />);

    const parseSpy = vi.spyOn(Date, "parse");
    const callsAfterMount = parseSpy.mock.calls.length;

    // Refresh only the current snapshot while keeping the identical history
    // series reference; memoized chart series must not re-run Date.parse.
    const updated = {
      ...value,
      data: {
        ...value.data,
        current: {
          ...value.data.current!,
          totals: { ...value.data.current!.totals, consumptionMw: 3200 },
        },
      },
    };
    rerender(<PowerDashboard envelope={updated} dataMode="live" />);

    expect(parseSpy.mock.calls.length).toBe(callsAfterMount);
  });
});
