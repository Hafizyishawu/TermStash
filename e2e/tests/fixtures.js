"use strict";

// Every test gets a page that fails it on any console error or any request
// leaving the site: "nothing leaves your browser" is a product promise, and
// these tests hold it to that.
const base = require("@playwright/test");

exports.test = base.test.extend({
  // A test that expects a specific console error opts in with test.use.
  allowedConsoleErrors: [[], { option: true }],
  page: async ({ page, context, baseURL, allowedConsoleErrors }, use) => {
    const problems = [];
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      if (allowedConsoleErrors.some((pattern) => pattern.test(message.text()))) return;
      problems.push(`console error: ${message.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
    // On the context, not the page: requests made by the service worker are
    // reported only there.
    context.on("request", (request) => {
      if (!request.url().startsWith(baseURL)) problems.push(`request left the site: ${request.url()}`);
    });
    await use(page);
    base.expect(problems).toEqual([]);
  },
});
exports.expect = base.expect;

// Pastes the way a user would, anywhere on the page: the app turns a paste
// into a search, and offers to save it when nothing matches.
exports.paste = (page, text) =>
  page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);

exports.saveCommand = async (page, { command, title }) => {
  await page.locator("#new-command").click();
  await page.locator("#field-command").fill(command);
  if (title) await page.locator("#field-title").fill(title);
  await page.locator("#editor-form button[type=submit]").click();
  await base.expect(page.locator("#editor-dialog")).not.toBeVisible();
};

exports.row = (page, title) => page.locator(".row", { has: page.locator(".row-title", { hasText: title }) });
