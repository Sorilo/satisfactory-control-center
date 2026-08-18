// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SectionStatus } from "./section-status";

describe("SectionStatus", () => {
  it("states staged data honestly without presenting it as an upstream error", () => {
    render(
      <SectionStatus
        title="Power"
        serverName="Main World"
        description="Grid capacity, demand, and reserve history."
      />
    );
    expect(screen.getByRole("heading", { name: "Power" })).toBeInTheDocument();
    expect(screen.getByText("Main World")).toBeInTheDocument();
    expect(screen.getByText(/planned vertical slice/i)).toBeInTheDocument();
    expect(screen.queryByText(/upstream unavailable/i)).not.toBeInTheDocument();
  });
});
