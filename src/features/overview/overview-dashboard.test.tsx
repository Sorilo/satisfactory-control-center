// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { OverviewEnvelope } from "@/contracts/public-contracts";
import { OverviewDashboard } from "./overview-dashboard";

const envelope: OverviewEnvelope = {
  apiVersion: "v1",
  generatedAt: "2026-08-18T18:00:01.000Z",
  serverId: "main",
  freshness: { state: "live", observedAt: "2026-08-18T18:00:00.000Z" },
  unavailableSources: [],
  data: {
    server: { online: true },
    session: { name: "Satisfriendery", uptimeSeconds: 3661, paused: false },
    players: { online: 2, names: ["Ada", "Grace"] },
    power: { capacityMw: 6000, consumptionMw: 3900, headroomMw: 2100, utilizationPercent: 65, fuseTriggered: false },
    factory: { machineCount: 184, producingCount: 171, averageEfficiencyPercent: 92.4 },
    progress: { items: [{ name: "Assembly Director System", delivered: 3100, required: 4000 }] }
  }
};

describe("OverviewDashboard", () => {
  it("answers what is happening and what needs attention", () => {
    render(<OverviewDashboard envelope={envelope} dataMode="mock" />);
    expect(screen.getByRole("heading", { name: /factory overview/i })).toBeInTheDocument();
    expect(screen.getByText("Mock telemetry")).toBeInTheDocument();
    expect(screen.getByText("2.10 GW")).toBeInTheDocument();
    expect(screen.getByText("6.00 GW")).toBeInTheDocument();
    expect(screen.getByText("65.0%")).toBeInTheDocument();
    expect(screen.queryByText(/Power production/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Ada, Grace/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /needs attention/i })).toBeInTheDocument();
    expect(screen.getByText(/900 remaining/i)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /Assembly Director System: 3100 of 4000 delivered/i })).toBeInTheDocument();
  });

  it("distinguishes upstream unavailability from a valid empty world", () => {
    render(<OverviewDashboard envelope={{ ...envelope, data: null, freshness: { state: "unavailable", observedAt: null }, unavailableSources: ["frm"] }} dataMode="live" />);
    expect(screen.getByRole("heading", { name: /realtime telemetry unavailable/i })).toBeInTheDocument();
    expect(screen.queryByText(/no players online/i)).not.toBeInTheDocument();
  });
});
