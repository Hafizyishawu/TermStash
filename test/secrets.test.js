"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { scan } = require("../src/secrets.js");
const corpus = require("./fixtures/secret-corpus.js");

// The detector is a classifier, so it is scored like one. Misses leak
// credentials into shared packs; false positives train people to click past
// the warning. Both are held at zero on the corpus, and the scores are printed
// so a regression shows up as a number, not just a failing case.
test("secret detector holds full precision and recall on the labeled corpus", () => {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  const failures = [];
  for (const { text, secret } of corpus) {
    const flagged = scan(text).length > 0;
    if (flagged && secret) truePositives++;
    else if (flagged && !secret) {
      falsePositives++;
      failures.push(`false positive (${scan(text).map((f) => f.id).join(", ")}): ${text}`);
    } else if (!flagged && secret) {
      falseNegatives++;
      failures.push(`missed: ${text}`);
    }
  }
  const precision = truePositives / (truePositives + falsePositives || 1);
  const recall = truePositives / (truePositives + falseNegatives || 1);
  console.log(`secret detector: precision=${precision.toFixed(3)} recall=${recall.toFixed(3)} n=${corpus.length}`);
  assert.deepEqual(failures, []);
});

test("empty and non-string input produce no findings", () => {
  assert.deepEqual(scan(""), []);
  assert.deepEqual(scan(undefined), []);
});

test("findings name the rule so the UI can explain the warning", () => {
  const [finding] = scan("psql postgresql://app:" + "hunter2secret@db/orders");
  assert.equal(finding.id, "url-credentials");
  assert.match(finding.label, /URL/);
});
