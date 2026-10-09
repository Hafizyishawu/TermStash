"use strict";

const { test, expect, paste, row } = require("./fixtures");

// Saving one suggestion used to hide all the others, which looked like they
// had been lost. Starters now stay until ten commands are saved, then a
// single line keeps the built-in catalog discoverable.
const starterRows = (page) => page.locator(".row.is-catalog");

function seedSaved(page, count) {
  const now = Date.now();
  const saved = Array.from({ length: count }, (_, index) => ({
    id: `seed-${index}`,
    title: `Seeded command ${index}`,
    command: `echo seeded-${index}`,
    description: "",
    tags: [],
    copyCount: 0,
    lastCopiedAt: null,
    createdAt: now,
    updatedAt: now,
  }));
  return page.addInitScript((state) => {
    if (!localStorage.getItem("termstash:v1")) localStorage.setItem("termstash:v1", state);
  }, JSON.stringify({ version: 1, commands: saved }));
}

test("saving one suggestion keeps the other starters visible", async ({ page }) => {
  await page.goto("/");
  const before = await starterRows(page).count();
  expect(before).toBeGreaterThan(1);
  const first = starterRows(page).first();
  const title = await first.locator(".row-title").textContent();
  await first.getByRole("button", { name: "Save", exact: true }).click();

  await expect(row(page, title).and(page.locator(".row.is-saved"))).toBeVisible();
  await expect(starterRows(page)).toHaveCount(before - 1);
  await expect(page.locator("#catalog-search-hint")).toBeHidden();
});

test("with ten saved commands the starters give way to a search hint", async ({ page }) => {
  await seedSaved(page, 10);
  await page.goto("/");
  await expect(page.locator(".row.is-saved")).toHaveCount(10);
  await expect(starterRows(page)).toHaveCount(0);
  await expect(page.locator("#catalog-search-hint")).toBeVisible();
  await expect(page.locator("#catalog-search-count")).not.toHaveText("0");

  await page.locator("#search").fill("kubectl");
  await expect(page.locator("#catalog-search-hint")).toBeHidden();
  await expect(starterRows(page).first()).toBeVisible();
});

test("with nine saved commands the starters are still offered", async ({ page }) => {
  await seedSaved(page, 9);
  await page.goto("/");
  await expect(starterRows(page).first()).toBeVisible();
  await expect(page.locator("#catalog-search-hint")).toBeHidden();
});

test("saving every starter leaves the search hint, not an empty catalog", async ({ page }) => {
  await page.goto("/");
  while ((await starterRows(page).count()) > 0) {
    // Save and Customize show only on the selected row, so select it first,
    // as a user clicks a row before acting on it.
    const next = starterRows(page).first();
    await next.locator(".row-title").click();
    await next.getByRole("button", { name: "Save", exact: true }).click();
  }
  expect(await page.locator(".row.is-saved").count()).toBeLessThan(10);
  await expect(page.locator("#catalog-search-hint")).toBeVisible();
});

const groupHeading = (page) => page.locator(".group-label > span").first();

test("a search with exact matches lists them as suggestions", async ({ page }) => {
  await page.goto("/");
  await page.locator("#search").fill("kubectl logs");
  await expect(groupHeading(page)).toHaveText("Suggestions");
  await expect(starterRows(page).first()).toBeVisible();
});

test("a search with a typo still shows the closest suggestions, and Enter saves the text", async ({ page }) => {
  await page.goto("/");
  await page.locator("#search").fill("kubctl logs");
  await expect(groupHeading(page)).toHaveText("Closest suggestions");
  // The typo is corrected for ranking, so kubectl commands come first.
  await expect(starterRows(page).first().locator(".row-command")).toContainText("kubectl");
  await expect(page.locator("#no-results")).toBeVisible();
  // Nothing is pre-selected, so Enter saves what was typed rather than
  // copying a guessed command.
  await expect(page.locator('.row[aria-current="true"]')).toHaveCount(0);
  await page.locator("#search").press("Enter");
  await expect(page.locator("#editor-dialog")).toBeVisible();
  await expect(page.locator("#field-command")).toHaveValue("kubctl logs");
});

test("choosing a closest suggestion with the arrow key, then Enter, copies it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  // "docker ps" ranks first for this typo and has no placeholders, so Enter
  // copies it directly.
  await page.locator("#search").fill("dokcer ps");
  await expect(groupHeading(page)).toHaveText("Closest suggestions");
  await expect(page.locator('.row[aria-current="true"]')).toHaveCount(0);
  await page.locator("#search").press("ArrowDown");
  await expect(page.locator('.row[aria-current="true"] .row-command')).toHaveText(/docker ps$/);
  await page.locator("#search").press("Enter");
  await expect(page.locator("#toast")).toContainText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("docker ps");
});

// Typos in the program name are corrected for ranking: adjacent swaps,
// a doubled letter, a dropped letter.
for (const [typed, expected] of [
  ["kubctl logs", "kubectl logs"],
  ["dokcer ps", "docker ps"],
  ["helmm upgrade", "helm upgrade"],
  ["terrafrom plan", "terraform plan"],
]) {
  test(`"${typed}" puts "${expected}" first among the closest suggestions`, async ({ page }) => {
    await page.goto("/");
    await page.locator("#search").fill(typed);
    await expect(groupHeading(page)).toHaveText("Closest suggestions");
    await expect(starterRows(page).first().locator(".row-command")).toContainText(expected);
  });
}

test("text sharing no word with the catalog shows no suggestions", async ({ page }) => {
  await page.goto("/");
  await page.locator("#search").fill("qwzx");
  await expect(starterRows(page)).toHaveCount(0);
  await expect(page.locator("#no-results")).toBeVisible();
});

test("an exact suggestion stays selected, so Enter copies it as before", async ({ page }) => {
  await page.goto("/");
  await page.locator("#search").fill("#kubectl");
  await expect(groupHeading(page)).toHaveText("Suggestions");
  await expect(page.locator('.row[aria-current="true"]')).toHaveCount(1);
  await expect(page.locator("#no-results-new kbd")).toBeHidden();
});

test("a tag still filters the closest suggestions", async ({ page }) => {
  await page.goto("/");
  await page.locator("#search").fill("#kubectl lgos");
  await expect(groupHeading(page)).toHaveText("Closest suggestions");
  const tools = await starterRows(page).locator(".row-tags").allTextContents();
  expect(tools.length).toBeGreaterThan(0);
  for (const tool of tools) expect(tool).toContain("kubectl");
});

test("a paste with no close match offers only to save it", async ({ page }) => {
  await page.goto("/");
  // Shares only the common word "deploy" with the catalog: noise for a paste.
  await paste(page, "zzcli deploy --target e2e-unique --wait");
  await expect(page.locator(".row.is-draft")).toBeVisible();
  await expect(page.locator(".group-label")).toHaveCount(0);
});
