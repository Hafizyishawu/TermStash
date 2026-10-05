"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parse, fill, segments } = require("../src/placeholders.js");

test("parse returns each placeholder once with its default", () => {
  assert.deepEqual(parse("kubectl -n {{ns:default}} logs {{pod}} -n {{ns}}"), [
    { name: "ns", defaultValue: "default" },
    { name: "pod", defaultValue: "" },
  ]);
});

test("a later occurrence can supply a default the first one lacked", () => {
  assert.deepEqual(parse("{{ns}} {{ns:prod}}"), [{ name: "ns", defaultValue: "prod" }]);
});

test("fill substitutes values, falls back to defaults, and reports what is missing", () => {
  const result = fill("ssh {{user:ubuntu}}@{{host}} -p {{port}}", { host: "10.0.0.5" });
  assert.equal(result.text, "ssh ubuntu@10.0.0.5 -p ");
  assert.deepEqual(result.missing, ["port"]);
});

test("an explicitly empty value falls back to the default", () => {
  assert.equal(fill("{{ns:prod}}", { ns: "" }).text, "prod");
});

test("braces that are not placeholders are left alone", () => {
  const command = "kubectl get pods -o jsonpath='{.items[*].metadata.name}' {{ x }}";
  assert.equal(fill(command, { x: "ok" }).text, "kubectl get pods -o jsonpath='{.items[*].metadata.name}' ok");
});

test("go template actions are not placeholders", () => {
  const command = "docker inspect {{name}} --format='{{range .Config.Env}}{{println .}}{{end}}'";
  assert.deepEqual(parse(command).map((p) => p.name), ["name"]);
  assert.equal(fill(command, { name: "api" }).text, "docker inspect api --format='{{range .Config.Env}}{{println .}}{{end}}'");
});

test("segments split literal text from placeholders for highlighting", () => {
  assert.deepEqual(segments("a {{b}} c"), [
    { type: "text", value: "a " },
    { type: "placeholder", value: "{{b}}", name: "b" },
    { type: "text", value: " c" },
  ]);
});

test("placeholders named after built-in Object properties are reported missing, not filled with function source", () => {
  const { text, missing } = fill("echo {{constructor}} {{toString}}", {});
  assert.equal(text, "echo  ");
  assert.deepEqual(missing, ["constructor", "toString"]);
});
