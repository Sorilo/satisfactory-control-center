// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell, resolveActiveServerId } from "./app-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams()
}));

describe("AppShell", () => {
  it("exposes all first-class views as navigation links", () => {
    render(<AppShell servers={[{ id: "main", displayName: "Main World" }]} defaultServerId="main"><div>content</div></AppShell>);
    for (const name of ["Overview", "Map", "Power", "Production", "Bottlenecks", "Factories", "Storage", "Trains", "Drones", "Players", "History"]) {
      expect(screen.getAllByRole("link", { name }).length).toBeGreaterThan(0);
    }
    expect(screen.getByLabelText(/active server/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Power" })).not.toHaveAttribute("aria-current");
  });

  it("keeps a valid selected server and rejects an unknown selection", () => {
    const servers = [{ id: "main", displayName: "Main World" }, { id: "beta", displayName: "Beta World" }];
    expect(resolveActiveServerId(servers, "main", "beta")).toBe("beta");
    expect(resolveActiveServerId(servers, "main", "unknown")).toBe("main");
  });
});
