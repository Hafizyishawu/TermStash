"use strict";

// Checks on the generated catalog that do not depend on the private rules
// file, so CI can run them. Organisation-specific scrubbing is enforced when
// the catalog is built; these catch the generic ways a scrub goes wrong.
const test = require("node:test");
const assert = require("node:assert/strict");
const catalog = require("../src/catalog.js");
const commands = require("../src/commands.js");
const secrets = require("../src/secrets.js");
const placeholders = require("../src/placeholders.js");

const LANGUAGES = new Set(["bash", "promql", "logql", "sql"]);

test("catalog is non-empty and frozen", () => {
  assert.ok(catalog.length > 100);
  assert.ok(Object.isFrozen(catalog));
});

test("every entry is a valid command with a stable unique id", () => {
  const ids = new Set();
  const problems = [];
  for (const entry of catalog) {
    for (const problem of commands.validate(entry)) problems.push(`${entry.id}: ${problem}`);
    if (!/^c-[0-9a-z]+$/.test(entry.id)) problems.push(`${entry.id}: malformed id`);
    if (ids.has(entry.id)) problems.push(`${entry.id}: duplicate id`);
    ids.add(entry.id);
    if (!LANGUAGES.has(entry.language)) problems.push(`${entry.id}: unexpected language ${entry.language}`);
    if (!entry.tags.includes(entry.tool)) problems.push(`${entry.id}: tags missing tool ${entry.tool}`);
  }
  assert.deepEqual(problems, []);
});

test("no two entries share a command", () => {
  const keys = catalog.map((entry) => commands.dedupeKey(entry.command));
  assert.equal(new Set(keys).size, keys.length);
});

test("no entry trips the secret detector", () => {
  const flagged = catalog.filter((entry) => secrets.scan(entry.command).length).map((entry) => entry.title);
  assert.deepEqual(flagged, []);
});

// Doc-style <name> markers should all have become {{placeholders}}. LogQL
// pattern expressions keep <name>, because there it is capture syntax.
test("no unconverted angle-bracket placeholders remain", () => {
  const leftovers = catalog
    .filter((entry) => !/\bpattern\s+"/.test(entry.command) && /<[A-Za-z][A-Za-z0-9_-]*>/.test(entry.command))
    .map((entry) => entry.command);
  assert.deepEqual(leftovers, []);
});

test("no internal hostnames or email addresses", () => {
  const leaks = catalog
    .map((entry) => [entry.title, entry.command, entry.description, entry.section].join("\n"))
    .map((text) => text.replace(/[A-Za-z0-9._%+-]+@example\.(?:com|org|net)\b/g, ""))
    .filter((text) => /\b[a-z0-9-]+\.internal\b/i.test(text) || /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/.test(text));
  assert.deepEqual(leaks, []);
});

test("placeholders parse and fill cleanly", () => {
  for (const entry of catalog) {
    const fields = placeholders.parse(entry.command);
    const values = Object.fromEntries(fields.map((field) => [field.name, "x"]));
    assert.deepEqual(placeholders.fill(entry.command, values).missing, [], entry.title);
  }
});

test("a small set of short starters covers several tools", () => {
  const starters = catalog.filter((entry) => entry.starter);
  assert.ok(starters.length >= 4 && starters.length <= 12, `${starters.length} starters`);
  assert.equal(new Set(starters.map((entry) => entry.tool)).size, starters.length);
  for (const starter of starters) assert.ok(!starter.command.includes("\n"), starter.title);
});
