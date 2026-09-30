#!/usr/bin/env node
// Validates and secret-scans every *.termstash.json under the given paths
// (default: packs/). Run in CI on any repository that stores shared packs, so a
// credential pasted into a team pack fails review before anyone imports it.
// Exits 1 if any pack is invalid or contains a possible secret.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const packs = require("../src/packs.js");
const secrets = require("../src/secrets.js");
const hidden = require("../src/hidden.js");

function findPackFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name.startsWith(".") ? [] : findPackFiles(full);
    return entry.name.endsWith(".termstash.json") ? [full] : [];
  });
}

function checkFile(file) {
  const { pack, errors } = packs.parse(fs.readFileSync(file, "utf8"));
  if (errors.length) return errors;
  return pack.commands.flatMap((cmd, index) => {
    const text = [cmd.title, cmd.command, cmd.description].join("\n");
    return [
      ...secrets.scan(text).map((finding) => `command ${index + 1} ("${cmd.title}"): possible secret, ${finding.label}`),
      ...hidden.scan(text).map((finding) => `command ${index + 1}: hidden character ${finding.code} (${finding.name}) x${finding.count}`),
    ];
  });
}

function main(argv) {
  const targets = argv.length ? argv : ["packs"];
  const files = targets.flatMap((target) => {
    if (!fs.existsSync(target)) {
      console.error(`check-packs: ${target} does not exist`);
      process.exitCode = 1;
      return [];
    }
    return findPackFiles(target);
  });
  let failures = 0;
  for (const file of files) {
    const problems = checkFile(file);
    if (problems.length) {
      failures++;
      for (const problem of problems) console.error(`${file}: ${problem}`);
    }
  }
  console.log(`check-packs: ${files.length} pack(s) checked, ${failures} with problems`);
  if (failures) process.exitCode = 1;
}

main(process.argv.slice(2));
