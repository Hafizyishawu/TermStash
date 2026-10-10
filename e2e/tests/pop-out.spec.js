"use strict";

const AxeBuilder = require("@axe-core/playwright").default;
const { test, expect, saveCommand } = require("./fixtures");

// "Pop out" moves the live interface into a Document Picture-in-Picture
// window that stays above other tabs and apps. Playwright sees that window
// as a new page in the same context.
async function popOut(page, context) {
  const opened = context.waitForEvent("page");
  await page.locator("#pop-out").click();
  const pip = await opened;
  await expect(pip.locator("#search")).toBeVisible();
  return pip;
}

test("pop out moves the app into its own window and the tab shows a placeholder", async ({ page, context }) => {
  await page.goto("/");
  const pip = await popOut(page, context);
  await expect(page.locator("#popped-out")).toBeVisible();
  await expect(page.locator("#search")).toHaveCount(0);
  await expect(pip.locator(".row").first()).toBeVisible();
  await expect(pip.locator("#pop-out")).toBeHidden();
});

test("commands saved before popping out can be found and copied from the pop-out", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await saveCommand(page, { command: "echo from-the-pop-out", title: "Pop out e2e" });
  // The app ignores Enter briefly after a dialog closes; wait as a person would.
  await expect(page.locator("#toast")).toBeHidden();
  const pip = await popOut(page, context);
  await pip.locator("#search").fill("from-the-pop-out");
  const row = pip.locator(".row.is-saved", { hasText: "Pop out e2e" });
  await expect(row).toBeVisible();
  await pip.locator("#search").press("Enter");
  await expect(pip.locator("#toast")).toContainText("Copied");
  expect(await pip.evaluate(() => navigator.clipboard.readText())).toBe("echo from-the-pop-out");
});

test("closing the pop-out brings the app back to the tab with its state", async ({ page, context }) => {
  await page.goto("/");
  const pip = await popOut(page, context);
  await pip.locator("#search").fill("kubectl");
  await pip.close();
  await expect(page.locator("#popped-out")).toBeHidden();
  await expect(page.locator("#search")).toBeVisible();
  await expect(page.locator("#search")).toHaveValue("kubectl");
});

test("the placeholder's button closes the pop-out and brings the app back", async ({ page, context }) => {
  await page.goto("/");
  const pip = await popOut(page, context);
  const closed = pip.waitForEvent("close");
  await page.locator("#pop-back").click();
  await closed;
  await expect(page.locator("#search")).toBeVisible();
});

test("the pop-out has no serious accessibility violations", async ({ page, context }) => {
  await page.goto("/");
  const pip = await popOut(page, context);
  // Scanning an unstyled page would pass contrast on browser defaults.
  const styled = await pip.evaluate(() => [...document.styleSheets].some((sheet) => sheet.href && sheet.href.endsWith("/app.css")));
  expect(styled).toBe(true);
  expect(await pip.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
  );
  await pip.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"), null, { timeout: 5000 });
  const results = await new AxeBuilder({ page: pip }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id)).toEqual([]);
});

test("browsers without Picture-in-Picture never see the button", async ({ page }) => {
  await page.addInitScript(() => { delete window.documentPictureInPicture; });
  await page.goto("/");
  await expect(page.locator("#search")).toBeVisible();
  await expect(page.locator("#pop-out")).toBeHidden();
});

test("a dialog open in the pop-out comes back to the tab still modal", async ({ page, context }) => {
  await page.goto("/");
  const pip = await popOut(page, context);
  await pip.locator("#new-command").click();
  await expect(pip.locator("#editor-dialog")).toBeVisible();
  await pip.close();
  await expect(page.locator("#editor-dialog")).toBeVisible();
  expect(await page.locator("#editor-dialog").evaluate((dialog) => dialog.matches(":modal"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("#editor-dialog")).toBeHidden();
});

test("keys pressed in the tab do not drive the pop-out", async ({ page, context }) => {
  await page.goto("/");
  const pip = await popOut(page, context);
  // The shortcut works in the pop-out, proving the key path is live. Search
  // has focus when the pop-out opens, where "n" is just typing, so leave it.
  await pip.evaluate(() => document.activeElement.blur());
  await pip.keyboard.press("n");
  await expect(pip.locator("#editor-dialog")).toBeVisible();
  await pip.keyboard.press("Escape");
  await expect(pip.locator("#editor-dialog")).toBeHidden();
  // ...and the same key pressed in the tab does nothing to it.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("n");
  await page.waitForTimeout(500);
  await expect(pip.locator("#editor-dialog")).toBeHidden();
});

test("a refused pop-out says so instead of failing silently", async ({ page }) => {
  await page.addInitScript(() => {
    window.documentPictureInPicture.requestWindow = () => Promise.reject(new DOMException("refused", "NotAllowedError"));
  });
  await page.goto("/");
  await page.locator("#pop-out").click();
  await expect(page.locator("#toast")).toContainText("Pop out isn't available here");
});

test("a double click opens one pop-out, not two", async ({ page, context }) => {
  // Opening is slowed so the second real click always lands while the first
  // pop-out is still opening: the race the guard prevents. Each click is a
  // genuine user gesture, which opening a pop-out requires.
  await page.addInitScript(() => {
    const original = window.documentPictureInPicture.requestWindow.bind(window.documentPictureInPicture);
    window.documentPictureInPicture.requestWindow = async (options) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return original(options);
    };
  });
  await page.goto("/");
  const pages = [];
  context.on("page", (opened) => pages.push(opened));
  await page.locator("#pop-out").dblclick();
  await expect.poll(() => pages.length).toBe(1);
  await expect(pages[0].locator("#search")).toBeVisible();
  // Long enough for a second window to have opened and replaced the first.
  await page.waitForTimeout(800);
  expect(pages).toHaveLength(1);
  expect(pages[0].isClosed()).toBe(false);
  expect(await pages[0].evaluate(() => document.body.textContent.includes("null"))).toBe(false);
  // Chrome refuses a second request once the first used the click's user
  // activation; without the guard that refusal reaches the user as an error.
  await expect(pages[0].locator("#toast")).not.toContainText("isn't available");
});

test("the app comes back even if the pop-out closes without a pagehide event", async ({ page, context }) => {
  // An abrupt close can skip pagehide; the tab must not lose the app.
  await page.addInitScript(() => {
    const original = window.documentPictureInPicture.requestWindow.bind(window.documentPictureInPicture);
    window.documentPictureInPicture.requestWindow = async (options) => {
      const pip = await original(options);
      const add = pip.addEventListener.bind(pip);
      pip.addEventListener = (type, ...rest) => (type === "pagehide" ? undefined : add(type, ...rest));
      return pip;
    };
  });
  await page.goto("/");
  const pip = await popOut(page, context);
  await pip.close();
  await expect(page.locator("#search")).toBeVisible();
  await expect(page.locator("#popped-out")).toBeHidden();
});
