import { expect, test } from "@playwright/test";

const privateTerms = /session_name|private-url|private-session|promql|fixture-|classname|location/i;

test.describe("Slice 2 Power", () => {
  test("renders current and retained power from the shared mock service", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "desktop evidence runs in the Chromium project");
    await page.goto("/power");

    await expect(page.getByRole("heading", { name: "Power grid" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Power", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("region", { name: /power key performance indicators/i })).toContainText("Reported maximum demand");
    await expect(page.getByRole("heading", { name: "Power history" })).toBeVisible();
    await expect(page.getByRole("group", { name: /power history trend/i })).toBeVisible();
    await expect(page.getByRole("table", { name: /power history series summary/i })).toBeVisible();
    await expect(page.getByRole("table", { name: /current power circuits/i })).toBeVisible();
    await expect(page.getByText(/historical production is not collected/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Generator details" })).toBeVisible();
    await expect(page.getByText("Biomass Burner")).toBeVisible();
    await expect(page.getByText(/biomass inventory 170 of 200/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Major consumers" })).toBeVisible();
    await expect(page.getByText("Miner Mk.1")).toBeVisible();
    await expect(page.getByRole("status", { name: "Power refresh status" })).toContainText(
      /Polling (fallback|degraded)/
    );

    await page.getByRole("link", { name: "7d", exact: true }).click();
    await expect(page).toHaveURL(/\/power\?.*range=7d/);
    await expect(page.getByRole("link", { name: "7d", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("body")).not.toContainText(privateTerms);

    await page.screenshot({ path: "test-results/power-desktop.png", fullPage: true });
  });

  test("remains usable without document overflow on a narrow mobile viewport", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "mobile evidence runs in the mobile project");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/power?range=24h&resolution=5m");

    await expect(page.getByRole("heading", { name: "Power grid" })).toBeVisible();
    await expect(page.getByRole("link", { name: "24h", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByLabel("Resolution")).toHaveValue("5m");
    await expect(page.getByRole("table", { name: /current power circuits/i })).toBeVisible();

    const viewportHasNoHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    );
    expect(viewportHasNoHorizontalOverflow).toBe(true);
    await expect(page.locator("body")).not.toContainText(privateTerms);

    await page.screenshot({ path: "test-results/power-mobile.png", fullPage: true });
  });

  test("charts reveal a bounded tooltip with client-derived headroom and utilization on mouse drag and keyboard", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "desktop interaction runs in the Chromium project");
    await page.goto("/power");

    const slider = page.getByRole("slider", { name: /scrub telemetry timeline/i });
    await expect(slider).toBeVisible();
    const plot = page.locator(".ttsc__plot");
    const tooltip = page.locator(".ttsc__tooltip");

    // Keyboard navigation lands on the last retained sample and exposes the
    // client-derived headroom and utilization alongside the raw series.
    await slider.focus();
    await slider.press("End");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("Capacity · Circuit 0");
    await expect(tooltip).toContainText("Headroom · Circuit 0");
    await expect(tooltip).toContainText("2,250 MW");
    await expect(tooltip).toContainText("Utilization · Circuit 0");
    await expect(tooltip).toContainText("73.5%");

    // The tooltip stays bounded inside the plot.
    const plotBox = await plot.boundingBox();
    const tooltipBox = await tooltip.boundingBox();
    expect(plotBox).not.toBeNull();
    expect(tooltipBox).not.toBeNull();
    expect(tooltipBox!.x).toBeGreaterThanOrEqual(plotBox!.x - 1);
    expect(tooltipBox!.y).toBeGreaterThanOrEqual(plotBox!.y - 1);
    expect(tooltipBox!.x + tooltipBox!.width).toBeLessThanOrEqual(plotBox!.x + plotBox!.width + 1);
    expect(tooltipBox!.y + tooltipBox!.height).toBeLessThanOrEqual(plotBox!.y + plotBox!.height + 1);

    // Mouse drag across the plot keeps the tooltip anchored and live.
    const box = await slider.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 30, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width - 30, box!.y + box!.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(tooltip).toBeVisible();
  });

  test("charts respond to a touch tap and drag on mobile without horizontal overflow", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "touch interaction runs in the mobile project");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/power");

    const slider = page.getByRole("slider", { name: /scrub telemetry timeline/i });
    await expect(slider).toBeVisible();
    const tooltip = page.locator(".ttsc__tooltip");
    const box = await slider.boundingBox();
    expect(box).not.toBeNull();
    const y = box!.y + box!.height / 2;
    const startX = box!.x + 40;
    const endX = box!.x + box!.width - 40;

    // Touch tap (pointer down/up with a touch pointer) opens the tooltip.
    await slider.dispatchEvent("pointerdown", {
      pointerType: "touch", pointerId: 7, isPrimary: true, clientX: startX, clientY: y, bubbles: true,
    });
    await slider.dispatchEvent("pointerup", {
      pointerType: "touch", pointerId: 7, isPrimary: true, clientX: startX, clientY: y, bubbles: true,
    });
    await expect(tooltip).toBeVisible();

    // Horizontal touch drag moves the scrub focus and keeps the tooltip live.
    await slider.dispatchEvent("pointerdown", {
      pointerType: "touch", pointerId: 8, isPrimary: true, clientX: startX, clientY: y, bubbles: true,
    });
    await slider.dispatchEvent("pointermove", {
      pointerType: "touch", pointerId: 8, isPrimary: true, clientX: endX, clientY: y, bubbles: true,
    });
    await slider.dispatchEvent("pointerup", {
      pointerType: "touch", pointerId: 8, isPrimary: true, clientX: endX, clientY: y, bubbles: true,
    });
    await expect(tooltip).toBeVisible();

    const viewportHasNoHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    );
    expect(viewportHasNoHorizontalOverflow).toBe(true);
  });
});
