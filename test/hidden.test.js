"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const hidden = require("../src/hidden.js");

test("ordinary commands, tabs, newlines and CRLF endings are not flagged", () => {
  for (const text of ["kubectl get pods -n prod", "a\tb", "line one\nline two", "line one\r\nline two", "echo 'café ünïcode 日本'"]) {
    assert.deepEqual(hidden.scan(text), [], JSON.stringify(text));
  }
});

test("bidirectional overrides and zero-width characters are flagged with counts", () => {
  const text = "ls \u202Etxt.hs\u202C \u200B\u200B";
  assert.deepEqual(hidden.scan(text), [
    { code: "U+202E", name: "Right-to-left override", count: 1 },
    { code: "U+202C", name: "Pop directional formatting", count: 1 },
    { code: "U+200B", name: "Zero-width space", count: 2 },
  ]);
});

test("a bare carriage return is flagged because it overwrites the visible line", () => {
  assert.deepEqual(hidden.scan("echo safe\rrm -rf ~").map((f) => f.code), ["U+000D"]);
});

test("other control characters and invisible separators are flagged", () => {
  const codes = hidden.scan("a\u0007b\u0000c\u2028d\uFEFF").map((f) => f.code);
  assert.deepEqual(codes, ["U+0007", "U+0000", "U+2028", "U+FEFF"]);
});

test("segments reproduce the text exactly and isolate each hidden character", () => {
  const text = "rm \u202Egnp.exe\u202C x";
  const parts = hidden.segments(text);
  assert.equal(parts.map((p) => p.value).join(""), text);
  assert.deepEqual(parts.filter((p) => p.type === "hidden").map((p) => p.code), ["U+202E", "U+202C"]);
});

// The repository itself must never contain hidden characters: an editor or
// tool that silently turns an escape into the real character would ship the
// exact problem this module exists to catch.
test("no source file in the repository contains hidden characters", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.resolve(__dirname, "..");
  const skip = new Set([".git", "node_modules", "dist", ".terraform"]);
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|mjs|json|html|css|md|yml|yaml|svg|webmanifest|txt|tf|sh)$|^_headers$|^LICENSE$/.test(entry.name)) {
        const findings = hidden.scan(fs.readFileSync(full, "utf8"));
        if (findings.length) offenders.push(`${path.relative(root, full)}: ${findings.map((f) => f.code).join(", ")}`);
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, []);
});

// Built from code points so this file stays free of the characters it tests.
test("C1 controls, unusual spaces, fillers, selectors and tag characters are flagged", () => {
  const points = [0x9b, 0xa0, 0xad, 0x115f, 0x1160, 0x1680, 0x2003, 0x202f, 0x205f, 0x206a, 0x3000, 0x3164, 0xfe0f, 0xffa0, 0xfffb, 0xe0041, 0xe0100];
  for (const point of points) {
    const findings = hidden.scan(`ls ${String.fromCodePoint(point)}x`);
    assert.equal(findings.length, 1, point.toString(16));
    assert.equal(findings[0].code, "U+" + point.toString(16).toUpperCase().padStart(4, "0"));
    assert.notEqual(findings[0].name, "Control character", point.toString(16));
  }
});

test("segments keep astral hidden characters whole", () => {
  const tag = String.fromCodePoint(0xe0041);
  const parts = hidden.segments(`a${tag}b`);
  assert.deepEqual(parts.map((p) => p.value), ["a", tag, "b"]);
  assert.deepEqual(hidden.segments(undefined), []);
});

test("an emoji presentation selector is allowed after an emoji but not after a letter", () => {
  const warning = String.fromCodePoint(0x26a0, 0xfe0f);
  assert.deepEqual(hidden.scan(`deploy ${warning} prod`), []);
  assert.deepEqual(hidden.scan(`depl${String.fromCodePoint(0xfe0f)}oy`).map((f) => f.code), ["U+FE0F"]);
});
