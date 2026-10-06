"use strict";

// deploy-pages.sh refuses to upload a site missing any file the build
// produces. Its dry run needs no credentials, so the refusal is testable.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "deploy-pages.sh");
const ENV = {
  ...process.env,
  CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  PAGES_PROJECT_NAME: "termstash",
  GITHUB_SHA: "0".repeat(40),
};
const expected = execFileSync("node", [path.join(ROOT, "scripts", "build-site.js"), "--list"], { encoding: "utf8" }).trim().split("\n");

function siteWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termstash-site-"));
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), "x");
  }
  return dir;
}

function dryRun(dir) {
  const result = spawnSync("bash", [SCRIPT, "--dry-run", dir], { env: ENV, encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

test("the build's file list includes the hidden security.txt and every script", () => {
  assert.ok(expected.includes(".well-known/security.txt"));
  assert.ok(expected.includes("404.html"));
  assert.ok(expected.some((file) => file.startsWith("src/")));
});

test("a complete site passes the dry run", () => {
  const result = dryRun(siteWith(expected));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dry run, would run/);
});

test("a site missing hidden files is refused before any upload", () => {
  const result = dryRun(siteWith(expected.filter((file) => !file.startsWith("."))));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /missing \.well-known\/security\.txt; not uploading/);
});
