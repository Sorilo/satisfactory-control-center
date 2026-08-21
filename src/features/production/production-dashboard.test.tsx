// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProductionDashboard } from "./production-dashboard";
import type { ProductionEnvelope } from "@/contracts/production-contracts";

const envelope: ProductionEnvelope = {
  apiVersion: "v1",
  generatedAt: "2026-08-21T03:00:00.000Z",
  serverId: "main",
  freshness: { state: "live", observedAt: "2026-08-21T03:00:00.000Z" },
  data: {
    items: [{
      itemKey: "iron-rod",
      name: "Iron Rod",
      form: "Solid",
      productionPerMinute: 120,
      consumptionPerMinute: 60,
      maxProductionPerMinute: 240,
      maxConsumptionPerMinute: 120,
      netPerMinute: 60,
      productionEfficiencyPercent: 50,
      consumptionEfficiencyPercent: 50,
      provenance: { throughput: "observed", capacity: "observed", net: "calculated" },
    }],
    total: 1,
    history: { state: "unsupported", reason: "production-history-not-observed" },
  },
  unavailableSources: [],
};

describe("ProductionDashboard", () => {
  it("renders current item detail and honest history state", () => {
    render(<ProductionDashboard envelope={envelope} dataMode="mock" search="iron" selectedItemKey="iron-rod" />);
    expect(screen.getByRole("heading", { name: /production/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Iron Rod" })).toBeInTheDocument();
    expect(screen.getByText(/history unsupported/i)).toBeInTheDocument();
    expect(screen.getAllByText("calculated")).toHaveLength(2);
  });

  it("renders a valid empty result without pretending the source failed", () => {
    render(<ProductionDashboard envelope={{ ...envelope, data: { ...envelope.data!, items: [], total: 0 } }} dataMode="mock" />);
    expect(screen.getByText(/no matching items/i)).toBeInTheDocument();
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
  });

  it("renders source-unavailable state without private details", () => {
    render(<ProductionDashboard envelope={{ ...envelope, freshness: { state: "unavailable", observedAt: null }, data: null, unavailableSources: ["frm"] }} dataMode="live" />);
    expect(screen.getByText(/production telemetry unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/frm:|token|password/i)).not.toBeInTheDocument();
  });
});
