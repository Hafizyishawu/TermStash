"use strict";

const { test, expect } = require("./fixtures");

// Installed, TermStash gets its own window and dock icon, apart from browser
// tabs. Chrome reports why a page is not installable; tests run in an
// incognito-like profile, which is the one reason allowed here.
test("Chrome considers the site installable as an app", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  expect(installabilityErrors.map((error) => error.errorId).filter((id) => id !== "in-incognito")).toEqual([]);
  const manifest = await cdp.send("Page.getAppManifest");
  expect(manifest.errors).toEqual([]);
});
