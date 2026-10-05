"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const commands = require("../src/commands.js");

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
    data,
  };
}

test("create normalizes fields and starts usage at zero", () => {
  const cmd = commands.create({ title: "  Logs ", command: "kubectl logs x  \n", tags: "K8s, #Debug, k8s" }, 1000);
  assert.equal(cmd.title, "Logs");
  assert.equal(cmd.command, "kubectl logs x");
  assert.deepEqual(cmd.tags, ["k8s", "debug"]);
  assert.equal(cmd.copyCount, 0);
  assert.equal(cmd.createdAt, 1000);
  assert.ok(cmd.id);
});

test("validate reports missing and oversized fields", () => {
  assert.deepEqual(commands.validate({ title: "t", command: "c" }), []);
  assert.equal(commands.validate({ title: "", command: "" }).length, 2);
  assert.equal(commands.validate({ title: "t", command: "x".repeat(10001) }).length, 1);
});

test("search requires every term and matches #tags exactly", () => {
  const list = [
    commands.create({ title: "Pod logs", command: "kubectl logs", tags: ["k8s"] }),
    commands.create({ title: "Docker logs", command: "docker logs", tags: ["docker"] }),
  ];
  assert.deepEqual(commands.search(list, "logs").length, 2);
  assert.deepEqual(commands.search(list, "logs #k8s").map((c) => c.title), ["Pod logs"]);
  assert.deepEqual(commands.search(list, "#k8").length, 0);
});

test("search ranks the most copied commands first", () => {
  const rare = commands.create({ title: "A", command: "a" });
  const frequent = commands.recordCopy(commands.recordCopy(commands.create({ title: "B", command: "b" })));
  assert.deepEqual(commands.search([rare, frequent], "").map((c) => c.title), ["B", "A"]);
});

test("dedupe key ignores whitespace differences", () => {
  assert.equal(commands.dedupeKey("kubectl  get\n pods "), commands.dedupeKey("kubectl get pods"));
});

test("load returns an empty state when nothing is stored", () => {
  const { state, error } = commands.load(memoryStorage());
  assert.equal(error, null);
  assert.deepEqual(state.commands, []);
});

test("load round-trips saved state", () => {
  const storage = memoryStorage();
  const state = { ...commands.emptyState(), commands: [commands.create({ title: "t", command: "c" })] };
  commands.save(storage, state);
  assert.deepEqual(commands.load(storage).state.commands, state.commands);
});

test("load repairs entries with missing optional fields so rendering cannot crash", () => {
  const storage = memoryStorage({
    [commands.STORAGE_KEY]: JSON.stringify({ version: 1, commands: [{ id: "a", title: "Logs", command: "kubectl logs", tags: ["K8s", 7] }, { id: "b", title: "t", command: "c" }] }),
  });
  const { state, error } = commands.load(storage);
  assert.equal(error, null);
  assert.deepEqual(state.commands[0].tags, ["k8s"]);
  assert.deepEqual(state.commands[1].tags, []);
  assert.equal(state.commands[1].description, "");
  assert.equal(state.commands[1].copyCount, 0);
  assert.doesNotThrow(() => commands.search(state.commands, "logs"));
});

test("load refuses entries it cannot repair and leaves the raw data in place", () => {
  const raw = JSON.stringify({ version: 1, commands: [{ id: "a", title: "ok", command: "ls" }, { title: 5 }] });
  const storage = memoryStorage({ [commands.STORAGE_KEY]: raw });
  const { state, error } = commands.load(storage);
  assert.equal(state, null);
  assert.match(error, /1 saved command/);
  assert.equal(storage.data[commands.STORAGE_KEY], raw);
});

test("load refuses corrupt or unknown data instead of discarding it", () => {
  const corrupt = memoryStorage({ [commands.STORAGE_KEY]: "{not json" });
  assert.equal(commands.load(corrupt).state, null);
  assert.match(commands.load(corrupt).error, /JSON/);
  assert.equal(corrupt.data[commands.STORAGE_KEY], "{not json");

  const future = memoryStorage({ [commands.STORAGE_KEY]: JSON.stringify({ version: 99, commands: [] }) });
  assert.match(commands.load(future).error, /unsupported/);
});

test("load gives repeated ids a fresh id so edits cannot hit the wrong command", () => {
  const storage = memoryStorage({
    [commands.STORAGE_KEY]: JSON.stringify({ version: 1, commands: [{ id: "a", title: "one", command: "ls" }, { id: "a", title: "two", command: "pwd" }] }),
  });
  const { state, error } = commands.load(storage);
  assert.equal(error, null);
  assert.equal(state.commands.length, 2);
  assert.equal(state.commands[0].id, "a");
  assert.notEqual(state.commands[1].id, "a");
});
