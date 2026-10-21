import { expect, test } from "@playwright/test";

// Requires the public Yannick Jadot profile, including its mandates and fact-checks.
// Run against a preview with BASE_URL=... npm run test:visual -- politician-mobile.
const PROFILE = "/politiques/yannick-jadot";

for (const width of [320, 360, 393, 640, 768, 1280]) {
  test(`profile affiliations fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto(PROFILE);
    const heading = page.getByRole("heading", { level: 1, name: "Yannick Jadot" });
    await expect(heading).toBeVisible();
    const header = heading.locator("../../..");
    const badges = header.locator('[data-slot="badge"]');
    expect(await badges.count()).toBeGreaterThanOrEqual(2);

    for (const badge of await badges.all()) {
      const box = await badge.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(await badge.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
  });
}

test("mobile shortcuts select visible panels and leave subsequent clicks usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 850 });
  // Enter through a Next Link rather than a full profile reload.
  await page.goto("/politiques?search=Yannick%20Jadot");
  await page.locator(`a[href="${PROFILE}"]:visible`).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Yannick Jadot" })).toBeVisible();

  await page.locator(`a[href="${PROFILE}#dossiers"]:visible`).first().click();
  const follow = page.getByRole("button", { name: "Suivre", exact: true });
  await follow.click();
  await expect(page.getByRole("button", { name: "Ne plus suivre", exact: true })).toBeVisible();

  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.isNavigationRequest() || request.headers()["rsc"] === "1") {
      requests.push(request.url());
    }
  });

  for (const [value, label] of [
    ["carriere", "Carrière"],
    ["factchecks", "Fact-checks"],
    ["patrimoine", "Patrimoine"],
    ["carriere", "Carrière"],
  ]) {
    await page.locator(`a[href="${PROFILE}?tab=${value}"]:visible`).first().click();
    await expect(page.getByRole("tab", { name: label, exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.getByRole("tabpanel")).toBeVisible();
    await expect(page.getByRole("tablist")).toBeInViewport();
  }
  expect(requests).toEqual([]);
});
