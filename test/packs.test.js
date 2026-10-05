"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const packs = require("../src/packs.js");
const commands = require("../src/commands.js");

const safe = commands.create({ title: "Pods", command: "kubectl get pods -n {{ns}}", tags: ["k8s"] });
const leaky = commands.create({ title: "DB", command: "psql postgresql://app:" + "hunter2secret@db/orders" });

test("export refuses commands that look like they contain secrets", () => {
  const { exportable, blocked } = packs.partitionForExport([safe, leaky]);
  assert.deepEqual(exportable, [safe]);
  assert.equal(blocked[0].command, leaky);
  assert.throws(() => packs.build("team", [safe, leaky]), /Refusing to export 1 command/);
});

test("exported packs carry no ids or personal usage data", () => {
  const pack = packs.build("team", [commands.recordCopy(safe)], new Date("2026-01-01T00:00:00Z"));
  assert.deepEqual(pack, {
    format: packs.FORMAT,
    version: packs.FORMAT_VERSION,
    name: "team",
    exportedAt: "2026-01-01T00:00:00.000Z",
    commands: [{ title: "Pods", command: "kubectl get pods -n {{ns}}", description: "", tags: ["k8s"] }],
  });
});

test("a built pack parses back to the same commands", () => {
  const text = packs.serialize(packs.build("team", [safe]));
  const { pack, errors } = packs.parse(text);
  assert.deepEqual(errors, []);
  assert.equal(pack.name, "team");
  assert.equal(pack.commands[0].command, safe.command);
});

test("parse rejects files that are not TermStash packs", () => {
  assert.match(packs.parse("nope").errors[0], /not valid JSON/);
  assert.match(packs.parse("[]").errors[0], /JSON object/);
  assert.match(packs.parse('{"format":"other"}').errors[0], /Not a TermStash pack/);
  assert.match(packs.parse('{"format":"termstash-pack","version":2,"commands":[]}').errors[0], /Unsupported pack version/);
  assert.match(packs.parse("x".repeat(packs.MAX_PACK_BYTES + 1)).errors[0], /1 MB/);
});

test("parse rejects the whole pack when any command is invalid", () => {
  const text = JSON.stringify({
    format: packs.FORMAT,
    version: packs.FORMAT_VERSION,
    commands: [{ title: "ok", command: "ls" }, { title: "", command: "rm" }],
  });
  const { pack, errors } = packs.parse(text);
  assert.equal(pack, null);
  assert.deepEqual(errors, ["Command 2: Title is required."]);
});

test("parse drops fields it does not know about", () => {
  const text = JSON.stringify({
    format: packs.FORMAT,
    version: packs.FORMAT_VERSION,
    commands: [{ title: "ok", command: "ls", copyCount: 999, id: "attacker-chosen", tags: ["A", 3] }],
  });
  assert.deepEqual(packs.parse(text).pack.commands[0], { title: "ok", command: "ls", description: "", tags: ["a"] });
});

test("import plan marks duplicates and secrets", () => {
  const incoming = {
    name: "p",
    commands: [
      { title: "same", command: "kubectl  get pods -n {{ns}}", description: "", tags: [] },
      { title: "new", command: "ls -la", description: "", tags: [] },
      { title: "again", command: "ls -la", description: "", tags: [] },
      { title: "leak", command: leaky.command, description: "", tags: [] },
    ],
  };
  const plan = packs.planImport([safe], incoming);
  assert.deepEqual(plan.map((p) => p.duplicate), [true, false, true, false]);
  assert.deepEqual(plan.map((p) => p.findings.length > 0), [false, false, false, true]);
});

test("import plan flags hidden characters so the preview can warn and leave them unchecked", () => {
  const incoming = {
    name: "p",
    commands: [
      { title: "clean", command: "ls -la", description: "", tags: [] },
      { title: "tricky", command: "echo ok\rrm -rf ~", description: "", tags: [] },
    ],
  };
  const plan = packs.planImport([], incoming);
  assert.deepEqual(plan[0].hiddenCharacters, []);
  assert.deepEqual(plan[1].hiddenCharacters.map((f) => f.code), ["U+000D"]);
});

test("hidden characters in tags are flagged on import", () => {
  const rlo = String.fromCodePoint(0x202e);
  const plan = packs.planImport([], { name: "p", commands: [{ title: "t", command: "ls", description: "", tags: [`k8s${rlo}`] }] });
  assert.deepEqual(plan[0].hiddenCharacters.map((f) => f.code), ["U+202E"]);
});

test("parse rejects a pack whose name contains hidden characters", () => {
  const text = JSON.stringify({
    format: packs.FORMAT,
    version: packs.FORMAT_VERSION,
    name: `Team ${String.fromCodePoint(0x202e)}sdnammoc`,
    commands: [{ title: "ok", command: "ls" }],
  });
  const { pack, errors } = packs.parse(text);
  assert.equal(pack, null);
  assert.deepEqual(errors, ["Pack name contains hidden characters (U+202E)."]);
});

test("secrets in tags block export", () => {
  const tagged = commands.create({ title: "t", command: "ls", tags: ["token=" + "s3cretValue9"] });
  assert.equal(packs.partitionForExport([tagged]).blocked.length, 1);
});
