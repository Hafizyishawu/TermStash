"use strict";

const AxeBuilder = require("@axe-core/playwright").default;
const { test, expect } = require("./fixtures");

// Serious and critical WCAG 2.1 A and AA violations fail the test; lesser
// ones are printed so they stay visible without blocking.
async function scan(page, name) {
  // Dialogs fade in; scanning mid-fade measures half-transparent text and
  // reports contrast failures that a settled page does not have. Opening a
  // dialog also cancels hover transitions, so wait for nothing to be running
  // rather than for every animation to finish.
  // Bounded, so a future infinite animation fails fast and clearly here.
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"), null, { timeout: 5000 });
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter((v) => ["serious", "critical"].includes(v.impact));
  for (const v of results.violations.filter((v) => !blocking.includes(v))) {
    console.log(`[a11y ${name}] ${v.impact}: ${v.id} (${v.nodes.length}) ${v.help}`);
  }
  expect(blocking.map((v) => `${v.impact}: ${v.id} - ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join("; ")})`)).toEqual([]);
}

// Both themes: contrast is a property of each palette, and the app follows
// the system setting.
for (const colorScheme of ["light", "dark"]) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("the main view has no serious accessibility violations", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator(".row").first()).toBeVisible();
      await scan(page, `main ${colorScheme}`);
    });

    test("the editor dialog has no serious accessibility violations", async ({ page }) => {
      await page.goto("/");
      await page.locator("#new-command").click();
      await expect(page.locator("#editor-dialog")).toBeVisible();
      await scan(page, `editor ${colorScheme}`);
    });
  });
}

test.describe("not found", () => {
  // The browser logs the page's own 404 status as a console error.
  test.use({ allowedConsoleErrors: [/status of 404/] });

  test("unknown paths get an accessible 404 page with a 404 status", async ({ page }) => {
    const response = await page.goto("/no-such-page");
    expect(response.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await scan(page, "404");
  });
});
