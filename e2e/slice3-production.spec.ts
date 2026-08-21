import { expect, test } from "@playwright/test";

test.describe("Slice 3 Production", () => {
  test("renders current production and an honest unsupported history state", async ({ page }) => {
    await page.goto("/production?serverId=main");
    await expect(page.getByRole("heading", { name: "Production", exact: true })).toBeVisible();
    await expect(page.getByRole("table", { name: /current production and consumption/i })).toBeVisible();
    await expect(page.getByText("History unsupported").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Iron Rod", exact: true })).toBeVisible();
  });

  test("searches by bounded normalized item and opens opaque item detail", async ({ page }) => {
    await page.goto("/production?serverId=main");
    await page.getByLabel("Search normalized item").fill("iron");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/\/production\?serverId=main&search=iron$/);
    await expect(page.getByRole("link", { name: "Iron Rod", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Iron Rod", exact: true }).click();
    await expect(page).toHaveURL(/\/production\?serverId=main&itemKey=iron-rod$/);
    await expect(page.getByRole("region", { name: /iron rod item detail/i })).toBeVisible();
    expect(await page.locator("main").textContent()).not.toMatch(/ClassName|items_produced_per_min|http:\/\//i);
  });

  test("distinguishes valid empty results from unavailable source", async ({ page }) => {
    await page.goto("/production?serverId=main&itemKey=missing-item");
    await expect(page.getByRole("heading", { name: "No matching items" })).toBeVisible();
    await expect(page.getByText(/valid empty result/i)).toBeVisible();
    await expect(page.getByText(/telemetry unavailable/i)).not.toBeVisible();
  });

  test("serves strict public production API", async ({ request }) => {
    const response = await request.get("/api/v1/production?serverId=main&search=iron");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.data.items[0].itemKey).toBe("iron-rod");
    expect(body.data.history).toEqual({ state: "unsupported", reason: "production-history-not-observed" });
    expect(JSON.stringify(body)).not.toMatch(/ClassName|items_produced_per_min|http:\/\/|token/i);

    const rejected = await request.get("/api/v1/production?serverId=main&metric=items_produced_per_min");
    expect(rejected.status()).toBe(400);
    expect((await rejected.json()).error.code).toBe("INVALID_QUERY");
  });

  test("fits the mobile viewport without page-level horizontal overflow", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "mobile viewport assertion");
    await page.goto("/production?serverId=main");
    await expect(page.getByRole("heading", { name: "Production", exact: true })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  });
});
