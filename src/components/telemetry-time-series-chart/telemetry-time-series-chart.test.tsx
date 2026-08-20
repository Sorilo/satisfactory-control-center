// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TelemetryTimeSeriesChart,
  type TelemetrySeries,
} from "./telemetry-time-series-chart";

// jsdom does not implement PointerEvent, so @testing-library/dom drops
// clientX/pointerId when it falls back to the generic Event constructor.
// Provide a MouseEvent-backed PointerEvent so pointer interactions carry
// real coordinates into React's synthetic event system.
class FakePointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "mouse";
    this.isPrimary = init.isPrimary ?? true;
  }
}
Object.defineProperty(window, "PointerEvent", {
  value: FakePointerEvent,
  configurable: true,
  writable: true,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  // jsdom returns zero-sized rects; give the plot a deterministic 800x300 box
  // so pointer coordinates map 1:1 into the SVG viewBox.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 300,
    width: 800,
    height: 300,
    toJSON: () => ({}),
  }) as DOMRect);
});

function makeSeries(): TelemetrySeries[] {
  return [
    {
      id: "capacity",
      label: "Capacity",
      color: "#e11",
      points: [
        { timestamp: 0, value: 10 },
        { timestamp: 1000, value: 20 },
        { timestamp: 2000, value: 30 },
        { timestamp: 3000, value:40 },
        { timestamp: 4000, value: 50 },
      ],
    },
    {
      id: "consumption",
      label: "Consumption",
      color: "#11e",
      points: [
        { timestamp: 0, value: 5 },
        { timestamp: 1000, value: 15 },
        { timestamp: 2000, value: 25 },
        { timestamp: 4000, value: 45 },
      ],
    },
  ];
}

describe("TelemetryTimeSeriesChart accessibility", () => {
  it("renders a labelled group with a scrubbing slider", () => {
    render(<TelemetryTimeSeriesChart series={makeSeries()} ariaLabel="Power history trend" />);
    expect(screen.getByRole("group", { name: "Power history trend" })).toBeInTheDocument();
    const slider = screen.getByRole("slider", { name: /scrub/i });
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", "4");
    expect(slider).toHaveAttribute("tabindex", "0");
  });

  it("renders an empty state without an interactive surface", () => {
    render(<TelemetryTimeSeriesChart series={[]} emptyLabel="No telemetry samples" ariaLabel="Telemetry" />);
    expect(screen.getByText("No telemetry samples")).toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("exposes a textual representation through aria-valuetext", () => {
    render(
      <TelemetryTimeSeriesChart
        series={makeSeries()}
        formatValue={(value) => `${value}W`}
        formatTime={(timestamp) => `T${timestamp}`}
      />
    );
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute("aria-valuetext", "T4000: Capacity 50W, Consumption 45W");
  });

  it("marks the visual tooltip aria-hidden so AT reads only the slider valuetext", () => {
    const { container } = render(<TelemetryTimeSeriesChart series={makeSeries()} />);
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "End" });
    const tooltip = container.querySelector(".ttsc__tooltip");
    expect(tooltip).not.toBeNull();
    expect(tooltip).toHaveAttribute("aria-hidden", "true");
  });

  it("announces the visible empty label through a status role instead of hiding it behind role=img", () => {
    render(<TelemetryTimeSeriesChart series={[]} emptyLabel="No telemetry samples" ariaLabel="Telemetry" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("No telemetry samples");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("TelemetryTimeSeriesChart interaction", () => {
  it("does not let tooltip-only mixed-unit series distort the visible line scale", () => {
    const { container } = render(
      <TelemetryTimeSeriesChart
        series={[
          {
            id: "mw",
            label: "Demand",
            points: [
              { timestamp: 1000, value: 100 },
              { timestamp: 2000, value: 200 },
            ],
          },
          {
            id: "percent",
            label: "Utilization",
            hidden: true,
            points: [
              { timestamp: 1000, value: 0 },
              { timestamp: 2000, value: 10_000 },
            ],
          },
        ]}
      />
    );

    const path = container.querySelector("path.ttsc__line");
    expect(path?.getAttribute("d")).toContain("12.0");
    expect(path?.getAttribute("d")).toContain("280.0");
  });

  it("updates the tooltip for all available series on pointer hover", () => {
    render(
      <TelemetryTimeSeriesChart
        series={makeSeries()}
        formatValue={(value) => `${value} W`}
        formatTime={(timestamp) => `T${timestamp}`}
      />
    );
    const slider = screen.getByRole("slider");
    fireEvent.pointerMove(slider, { clientX: 416, clientY: 150 });
    expect(screen.getByText("T2000")).toBeInTheDocument();
    expect(screen.getByText("30 W")).toBeInTheDocument();
    expect(screen.getByText("25 W")).toBeInTheDocument();
  });

  it("snaps ragged series to their nearest full-data point", () => {
    render(
      <TelemetryTimeSeriesChart
        series={makeSeries()}
        formatValue={(value) => `${value}`}
        formatTime={(timestamp) => `${timestamp}`}
      />
    );
    const slider = screen.getByRole("slider");
    // t=3000: capacity has an exact point (40); consumption has none and its
    // nearest (equidistant between 2000 and 4000) resolves to 2000 -> 25.
    fireEvent.pointerMove(slider, { clientX: 600, clientY: 150 });
    expect(screen.getByText("3000")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();
  });

  it("renders a crosshair and one marker per available series while focused", () => {
    const { container } = render(<TelemetryTimeSeriesChart series={makeSeries()} />);
    const slider = screen.getByRole("slider");
    fireEvent.pointerMove(slider, { clientX: 416, clientY: 150 });
    expect(container.querySelector(".ttsc__crosshair")).not.toBeNull();
    expect(container.querySelectorAll(".ttsc__marker")).toHaveLength(2);
  });

  it("moves focus with arrow keys, Home, and End", () => {
    render(
      <TelemetryTimeSeriesChart series={makeSeries()} formatTime={(timestamp) => `T${timestamp}`} />
    );
    const slider = screen.getByRole("slider");
    slider.focus();

    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("T0")).toBeInTheDocument();

    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByText("T1000")).toBeInTheDocument();

    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute("aria-valuenow", "4");
    expect(screen.getByText("T4000")).toBeInTheDocument();

    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(slider).toHaveAttribute("aria-valuenow", "3");

    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider).toHaveAttribute("aria-valuenow", "0");
  });

  it("supports touch pointerdown capture and horizontal drag", () => {
    render(
      <TelemetryTimeSeriesChart series={makeSeries()} formatTime={(timestamp) => `T${timestamp}`} />
    );
    const slider = screen.getByRole("slider");
    fireEvent.pointerDown(slider, { clientX: 48, clientY: 150, pointerId: 7 });
    expect(screen.getByText("T0")).toBeInTheDocument();
    fireEvent.pointerMove(slider, { clientX: 600, clientY: 150, pointerId: 7 });
    expect(screen.getByText("T3000")).toBeInTheDocument();
    fireEvent.pointerUp(slider, { pointerId: 7 });
    expect(screen.getByText("T3000")).toBeInTheDocument();
  });

  it("clears the hover focus when the pointer leaves without dragging", () => {
    render(
      <TelemetryTimeSeriesChart series={makeSeries()} formatTime={(timestamp) => `T${timestamp}`} />
    );
    const slider = screen.getByRole("slider");
    fireEvent.pointerMove(slider, { clientX: 416, clientY: 150 });
    expect(screen.getByText("T2000")).toBeInTheDocument();
    fireEvent.pointerLeave(slider);
    expect(screen.queryByText("T2000")).not.toBeInTheDocument();
  });

  it("downsamples the rendered path while keeping full data inspectable", () => {
    const { container } = render(
      <TelemetryTimeSeriesChart
        series={[
          {
            id: "ramp",
            label: "Ramp",
            points: Array.from({ length: 200 }, (_, i) => ({ timestamp: i, value: i })),
          },
        ]}
        maxRenderPoints={4}
        formatValue={(value) => `v${value}`}
        formatTime={(timestamp) => `t${timestamp}`}
      />
    );
    const path = container.querySelector("path.ttsc__line") as SVGPathElement;
    expect(path).not.toBeNull();
    const drawCommands = (path.getAttribute("d") ?? "").match(/[ML]/g) ?? [];
    expect(drawCommands.length).toBeLessThanOrEqual(4);

    const slider = screen.getByRole("slider");
    const x = 48 + (100 / 199) * 736;
    fireEvent.pointerMove(slider, { clientX: x, clientY: 150 });
    expect(screen.getByText("t100")).toBeInTheDocument();
    expect(screen.getByText("v100")).toBeInTheDocument();
  });

  it("caps the tooltip series list and discloses the omitted count", () => {
    const many: TelemetrySeries[] = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`,
      label: `Series ${i}`,
      points: [
        { timestamp: 0, value: i },
        { timestamp: 1000, value: i + 100 },
      ],
    }));
    const { container } = render(
      <TelemetryTimeSeriesChart series={many} maxTooltipEntries={3} formatValue={(value) => `${value}`} />
    );
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "End" });
    expect(screen.getByText("+7 more series")).toBeInTheDocument();
    // The tooltip is aria-hidden (its content is mirrored by aria-valuetext),
    // so assert its list structure via the DOM rather than the a11y tree.
    const list = container.querySelector(".ttsc__tooltip-list");
    expect(list).not.toBeNull();
    expect(list!.querySelectorAll("li")).toHaveLength(3);
  });

  it("formats each series with its own unit and omits hidden series from the drawn paths", () => {
    const { container } = render(
      <TelemetryTimeSeriesChart
        series={[
          {
            id: "capacity",
            label: "Capacity",
            points: [
              { timestamp: 0, value: 100 },
              { timestamp: 1000, value: 200 },
            ],
            formatValue: (value) => `${value} MW`,
          },
          {
            id: "utilization",
            label: "Utilization",
            points: [
              { timestamp: 0, value: 50 },
              { timestamp: 1000, value: 60 },
            ],
            formatValue: (value) => `${value}%`,
            hidden: true,
          },
        ]}
        formatValue={(value) => `${value} raw`}
        formatTime={(timestamp) => `T${timestamp}`}
      />
    );

    // Only the visible series is drawn; the hidden series has no path or marker.
    expect(container.querySelectorAll("path.ttsc__line")).toHaveLength(1);

    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "End" });
    expect(screen.getByText("200 MW")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.queryByText(/raw/)).not.toBeInTheDocument();
    expect(container.querySelectorAll(".ttsc__marker")).toHaveLength(1);
  });

  it("omits exact-sample derived series at non-intersection timestamps and reports them at intersections", () => {
    render(
      <TelemetryTimeSeriesChart
        series={[
          {
            id: "capacity",
            label: "Capacity",
            points: [
              { timestamp: 0, value: 10 },
              { timestamp: 2000, value: 30 },
              { timestamp: 4000, value: 50 },
            ],
          },
          {
            id: "consumption",
            label: "Consumption",
            points: [
              { timestamp: 0, value: 5 },
              { timestamp: 1000, value: 15 },
              { timestamp: 4000, value: 45 },
            ],
          },
          {
            id: "headroom",
            label: "Headroom",
            hidden: true,
            sampleMode: "exact",
            points: [
              { timestamp: 0, value: 5 },
              { timestamp: 4000, value: 5 },
            ],
          },
        ]}
        formatValue={(value) => `${value}`}
        formatTime={(timestamp) => `T${timestamp}`}
      />
    );
    const slider = screen.getByRole("slider");

    // t=1000 only exists in consumption; the derived headroom must be omitted.
    fireEvent.keyDown(slider, { key: "Home" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuetext", "T1000: Capacity 10, Consumption 15");
    expect(screen.queryByText("Headroom")).not.toBeInTheDocument();

    // t=4000 is an intersection; the derived headroom is reported.
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute(
      "aria-valuetext",
      "T4000: Capacity 50, Consumption 45, Headroom 5"
    );
    expect(screen.getByText("Headroom")).toBeInTheDocument();
  });

  it("clears the drag latch on pointer cancel and keeps the touch tooltip", () => {
    render(<TelemetryTimeSeriesChart series={makeSeries()} formatTime={(timestamp) => `T${timestamp}`} />);
    const slider = screen.getByRole("slider");
    fireEvent.pointerDown(slider, { clientX: 48, clientY: 150, pointerId: 7, pointerType: "touch" });
    fireEvent.pointerMove(slider, { clientX: 600, clientY: 150, pointerId: 7, pointerType: "touch" });
    expect(screen.getByText("T3000")).toBeInTheDocument();

    fireEvent.pointerCancel(slider, { pointerId: 7, pointerType: "touch" });
    // A cancelled touch leaves the tooltip it opened (sensible)…
    expect(screen.getByText("T3000")).toBeInTheDocument();

    // …and the drag latch is cleared, so a later mouse leave still clears hover.
    fireEvent.pointerLeave(slider, { pointerType: "mouse" });
    expect(screen.queryByText("T3000")).not.toBeInTheDocument();
  });

  it("clamps the tooltip width to the plot width on a narrow layout", () => {
    vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(
      () =>
        ({
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          right: 180,
          bottom: 300,
          width: 180,
          height: 300,
          toJSON: () => ({}),
        }) as DOMRect
    );
    const { container } = render(
      <TelemetryTimeSeriesChart series={makeSeries()} formatTime={(timestamp) => `T${timestamp}`} />
    );
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "End" });

    const tooltip = container.querySelector(".ttsc__tooltip") as HTMLElement;
    expect(tooltip).not.toBeNull();
    expect(tooltip.style.width).toBe("180px");

    // The clamped tooltip still sits entirely inside the 180px plot.
    const left = parseFloat(tooltip.style.left);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + 180).toBeLessThanOrEqual(181);
  });
});
