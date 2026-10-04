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
