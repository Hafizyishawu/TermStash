"use strict";

const { test, expect, paste, saveCommand, row } = require("./fixtures");

test("loads with its security policy and blocks all network access", async ({ page }) => {
  const response = await page.goto("/");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-security-policy"]).toContain("connect-src 'none'");
  await expect(page.locator("#search")).toBeVisible();
});

test("a pasted command can be saved under a suggested name and survives a reload", async ({ page }) => {
  const command = "echo termstash-e2e-marker --from paste";
  await page.goto("/");
  await paste(page, command);
  // With nothing matching, the paste becomes a draft row offering to save it.
  const draft = page.locator(".row.is-draft");
  await expect(draft.locator(".row-title")).toHaveText("Save as new command");
  await draft.getByRole("button", { name: /Save/ }).click();
  await expect(page.locator("#editor-dialog")).toBeVisible();
  await expect(page.locator("#field-command")).toHaveValue(command);
  await expect(page.locator("#field-title")).not.toHaveValue("");
  const title = await page.locator("#field-title").inputValue();
  await page.locator("#editor-form button[type=submit]").click();
  await expect(row(page, title)).toBeVisible();

  await page.reload();
  await expect(row(page, title)).toBeVisible();
});

test("search narrows the list to matching commands", async ({ page }) => {
  await page.goto("/");
  await saveCommand(page, { command: "echo alpha-e2e", title: "Alpha e2e" });
  await saveCommand(page, { command: "echo beta-e2e", title: "Beta e2e" });
  await page.locator("#search").fill("alpha-e2e");
  await expect(row(page, "Alpha e2e")).toBeVisible();
  await expect(row(page, "Beta e2e")).toHaveCount(0);
});

test("filling placeholders copies the completed command, defaults included", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await saveCommand(page, { command: "kubectl logs {{pod}} -n {{namespace:default}}", title: "Pod logs e2e" });
  await row(page, "Pod logs e2e").getByRole("button", { name: /Fill & copy/ }).click();
  await expect(page.locator("#fill-dialog")).toBeVisible();
  await page.locator('#fill-fields input[data-name="pod"]').fill("api-7f9");
  await expect(page.locator("#fill-preview")).toHaveText("kubectl logs api-7f9 -n default");
  await page.locator("#fill-submit").click();
  await expect(page.locator("#toast")).toContainText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("kubectl logs api-7f9 -n default");
});

test("deleting asks for confirmation, then removes the command", async ({ page }) => {
  await page.goto("/");
  await saveCommand(page, { command: "echo delete-me-e2e", title: "Delete me e2e" });
  await row(page, "Delete me e2e").getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("#confirm-dialog")).toBeVisible();
  await page.locator("#confirm-accept").click();
  await expect(row(page, "Delete me e2e")).toHaveCount(0);
  await page.reload();
  await expect(row(page, "Delete me e2e")).toHaveCount(0);
});

test("import flags hidden characters and leaves those commands unticked", async ({ page }) => {
  // Built from a code point so this file stays free of the character it tests.
  const rightToLeftOverride = String.fromCodePoint(0x202e);
  const pack = {
    format: "termstash-pack",
    version: 1,
    name: "E2E pack",
    commands: [
      { title: "Clean e2e", command: "ls -la" },
      { title: "Tricky e2e", command: `echo safe ${rightToLeftOverride}txt.exe` },
    ],
  };
  await page.goto("/");
  await page.locator("#import-file").setInputFiles({
    name: "e2e.termstash.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(pack)),
  });
  await expect(page.locator("#import-dialog")).toBeVisible();
  const clean = page.locator(".import-item", { hasText: "Clean e2e" });
  const tricky = page.locator(".import-item", { hasText: "Tricky e2e" });
  await expect(clean.locator("input[type=checkbox]")).toBeChecked();
  await expect(tricky.locator(".badge-danger")).toContainText("U+202E");
  await expect(tricky.locator("input[type=checkbox]")).not.toBeChecked();
});

test("export refuses a command that looks like it holds a secret", async ({ page }) => {
  await page.goto("/");
  await saveCommand(page, { command: "echo safe-e2e", title: "Safe e2e" });
  // Saving a secret is allowed, but only after a warning that names it.
  await page.locator("#new-command").click();
  await page.locator("#field-command").fill("curl -u admin:" + "correcthorse" + " https://registry.example.com");
  await page.locator("#field-title").fill("Leaky e2e");
  await page.locator("#editor-form button[type=submit]").click();
  await expect(page.locator("#confirm-dialog")).toBeVisible();
  await expect(page.locator("#confirm-heading")).toContainText("looks like it has a secret");
  await expect(page.locator("#confirm-message")).toContainText("Password in -u/--user flag");
  await page.locator("#confirm-accept").click();
  await expect(row(page, "Leaky e2e").locator(".badge-warn")).toContainText("Possible secret");
  await page.locator("#export-pack").click();
  await expect(page.locator("#export-dialog")).toBeVisible();
  await expect(page.locator("#export-blocked")).toBeVisible();
  await expect(page.locator("#export-blocked")).toContainText("Leaky e2e");
  await expect(page.locator("#export-blocked")).not.toContainText("Safe e2e");
});
