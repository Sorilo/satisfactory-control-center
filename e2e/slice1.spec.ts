import { expect, test } from "@playwright/test";

test.describe("Slice 1 control center", () => {
  test("renders a useful overview and honest staged destinations", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Factory overview" })).toBeVisible();
    await expect(page.getByText("Mock telemetry")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
    await expect(page.getByLabel("Active server")).toHaveValue("main");
    await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();

    await page.getByRole("link", { name: "Power", exact: true }).click();
    await expect(page).toHaveURL(/\/power\?serverId=main$/);
    await expect(page.getByRole("heading", { name: "Power", exact: true })).toBeVisible();
    await expect(page.getByText(/planned vertical slice/i)).toBeVisible();
    await expect(page.getByText(/No telemetry is being inferred or fabricated/i)).toBeVisible();
  });

  test("serves strict public API and health contracts", async ({ request }) => {
    const servers = await request.get("/api/v1/servers");
    expect(servers.status()).toBe(200);
    const catalog = await servers.json();
    expect(catalog).toEqual({ defaultServerId: "main", servers: [
      { id: "main", displayName: "Main World" },
      { id: "beta", displayName: "Beta World" }
    ] });
    expect(JSON.stringify(catalog)).not.toMatch(/token|baseUrl|8080/i);

    const overview = await request.get("/api/v1/overview?serverId=main");
    expect(overview.status()).toBe(200);
    expect((await overview.json()).freshness.state).toBe("live");

    const rejected = await request.get("/api/v1/overview?serverId=http%3A%2F%2F169.254.169.254");
    expect(rejected.status()).toBe(400);
    expect(JSON.stringify(await rejected.json())).not.toContain("169.254");

    expect((await request.get("/api/health/live")).status()).toBe(200);
    expect((await request.get("/api/health/ready")).status()).toBe(200);
  });

  test("fits the mobile viewport without page-level horizontal overflow", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "mobile viewport assertion");
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Factory overview" })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
    await page.getByText("More", { exact: true }).click();
    await expect(page.getByRole("group").getByRole("link", { name: "History", exact: true })).toBeVisible();
  });

  test("propagates the selected server through navigation", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Active server").selectOption("beta");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/\/?\?serverId=beta$/);
    await expect(page.getByLabel("Active server")).toHaveValue("beta");
    await page.getByRole("link", { name: "Power", exact: true }).click();
    await expect(page).toHaveURL(/\/power\?serverId=beta$/);
    await expect(page.getByRole("article").getByText("Beta World", { exact: true })).toBeVisible();
  });
});
