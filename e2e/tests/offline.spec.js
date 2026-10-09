"use strict";

const { test, expect } = require("./fixtures");

// Automates the manual DevTools check from docs/runbooks/deploy-and-rollback.md:
// the worker activates, caches the shell, and the app loads with no network.
test("the app installs its service worker and works offline", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cached = await page.evaluate(async () => {
    const cache = await caches.open("termstash-shell");
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  });
  expect(cached).toEqual(expect.arrayContaining(["/", "/index.html", "/app.css", "/src/app.js", "/src/catalog.js"]));

  await context.setOffline(true);
  const reloaded = await page.reload();
  // Proves the page came from the worker's cache, not from the local server.
  expect(reloaded.fromServiceWorker()).toBe(true);
  await expect(page.locator("#search")).toBeVisible();
  await expect(page.locator(".row").first()).toBeVisible();
  await context.setOffline(false);
});
