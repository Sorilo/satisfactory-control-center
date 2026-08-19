import { expect, test } from "@playwright/test";

const privateTerms = /session_name|private-url|private-session|promql/i;

test.describe("Slice 2 Power", () => {
  test("renders current and retained power from the shared mock service", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "desktop evidence runs in the Chromium project");
    await page.goto("/power");

    await expect(page.getByRole("heading", { name: "Power grid" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Power", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("region", { name: /power key performance indicators/i })).toContainText("Reported maximum demand");
    await expect(page.getByRole("heading", { name: "Power history" })).toBeVisible();
    await expect(page.getByRole("img", { name: /power history trend/i })).toBeVisible();
    await expect(page.getByRole("table", { name: /power history series summary/i })).toBeVisible();
    await expect(page.getByRole("table", { name: /current power circuits/i })).toBeVisible();
    await expect(page.getByText(/historical production is not collected/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: /generator details unavailable/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /major-consumer details unavailable/i })).toBeVisible();
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
});
