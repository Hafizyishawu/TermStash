"use strict";

// security.txt (RFC 9116) tells researchers where to report. An expired one
// signals that the contact may be dead, and nobody remembers a date six
// months away.
//
// Renewal is enforced by the weekly scheduled workflow, which sets
// SECURITY_TXT_STRICT=true and fails 30 days before Expires. Pull requests
// and deploys only warn about it, so a hotfix is never blocked by a date;
// they still fail on authoring mistakes.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RENEW_BEFORE_DAYS = 30;
const STRICT = process.env.SECURITY_TXT_STRICT === "true";
const MAX_LIFETIME_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;
const text = fs.readFileSync(path.join(__dirname, "..", ".well-known", "security.txt"), "utf8");

function fields() {
  const result = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Za-z-]+):\s*(.+?)\s*$/);
    if (match) (result[match[1].toLowerCase()] ||= []).push(match[2]);
  }
  return result;
}

test("security.txt has exactly one Expires and at least one Contact", () => {
  const found = fields();
  assert.equal(found.expires?.length, 1);
  assert.ok(found.contact?.length >= 1);
});

test("security.txt Expires is a valid date under a year away, and not due for renewal", () => {
  const expires = Date.parse(fields().expires[0]);
  assert.ok(!Number.isNaN(expires), "Expires must be an RFC 3339 timestamp");
  const daysLeft = (expires - Date.now()) / DAY_MS;
  assert.ok(daysLeft <= MAX_LIFETIME_DAYS, "RFC 9116 recommends an Expires less than a year away");
  if (daysLeft >= RENEW_BEFORE_DAYS) return;
  const message = `security.txt expires in ${Math.floor(daysLeft)} days; renew it (docs/runbooks/deploy-and-rollback.md)`;
  if (STRICT) assert.fail(message);
  // A GitHub Actions annotation, visible on the run without failing it.
  console.log(`::warning file=.well-known/security.txt::${message}`);
});

test("security.txt links use https and the canonical URL is where it is served", () => {
  const found = fields();
  for (const key of ["contact", "canonical", "policy"]) {
    for (const value of found[key] || []) assert.match(value, /^https:\/\//, `${key} must be an https URL`);
  }
  assert.deepEqual(found.canonical, ["https://termstash.app/.well-known/security.txt"]);
});
