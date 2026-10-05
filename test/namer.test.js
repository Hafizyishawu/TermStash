"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { suggestTitle, tokenize } = require("../src/namer.js");
const corpus = require("./fixtures/naming-corpus.json");

// Exact-match accuracy over a labeled set. A rule change that improves one
// tool but regresses another shows up here as a lower score and a named case.
test("namer matches every labeled example in the corpus", () => {
  const failures = corpus
    .map(({ command, expected }) => ({ command, expected, actual: suggestTitle(command) }))
    .filter(({ expected, actual }) => expected !== actual);
  const accuracy = (corpus.length - failures.length) / corpus.length;
  console.log(`namer: exact-match accuracy=${accuracy.toFixed(3)} n=${corpus.length}`);
  assert.deepEqual(
    failures.map((f) => `${f.command}\n    expected: ${f.expected}\n    actual:   ${f.actual}`),
    [],
  );
});

test("blank input has no suggestion", () => {
  assert.equal(suggestTitle(""), "");
  assert.equal(suggestTitle("   "), "");
  assert.equal(suggestTitle("FOO=bar"), "");
});

test("long titles are truncated with an ellipsis", () => {
  const title = suggestTitle(`mytool ${"x".repeat(200)}`);
  assert.ok(title.length <= 80);
  assert.ok(title.endsWith("…"));
});

test("tokenizer keeps quoted operators inside words", () => {
  const tokens = tokenize("echo 'a | b' && ls");
  assert.deepEqual(tokens, [{ word: "echo" }, { word: "a | b" }, { op: "&&" }, { word: "ls" }]);
});

// Lookup tables are keyed by words from the command; inherited Object names
// once crashed every render or produced function source as a title.
test("program names that match built-in Object properties are treated as ordinary tools", () => {
  assert.equal(suggestTitle("toString -a b"), "toString: -a b");
  assert.equal(suggestTitle("constructor x"), "constructor: x");
  assert.equal(suggestTitle("hasOwnProperty"), "hasOwnProperty");
  assert.equal(suggestTitle("docker valueOf"), "docker: valueOf");
});

test("verbs missing their target are named without an undefined placeholder", () => {
  for (const command of ["kubectl logs", "kubectl exec", "kubectl scale", "docker run", "docker exec", "docker logs"]) {
    assert.doesNotMatch(suggestTitle(command), /undefined/, command);
  }
});

test("curl -O takes no value but wget -O does", () => {
  assert.match(suggestTitle("curl -O https://example.com/f.tgz"), /example\.com/);
  assert.match(suggestTitle("wget -O out.tgz https://example.com/f.tgz"), /example\.com/);
});

test("timeout skips its valued options before the wrapped command", () => {
  assert.equal(suggestTitle("timeout -s KILL 10 make build"), suggestTitle("make build"));
});
