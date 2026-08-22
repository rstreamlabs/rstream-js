import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const candidateWorkflow = fs.readFileSync(
  ".github/workflows/release.yml",
  "utf8",
);

test("release workflow creates a candidate without publishing", () => {
  assert.match(candidateWorkflow, /Pack immutable candidate/);
  assert.match(
    candidateWorkflow,
    /npm-release-candidate-\$\{\{ github\.sha \}\}/,
  );
  assert.doesNotMatch(candidateWorkflow, /publish: npm run ci:release/);
  assert.equal(candidateWorkflow.match(/id-token: write/g)?.length, 1);
});

test("promotion requires approval and publishes exact archives", () => {
  assert.match(candidateWorkflow, /environment: stable-release/);
  assert.match(candidateWorkflow, /publish-npm-release\.sh candidate/);
  assert.match(candidateWorkflow, /id-token: write/);
  assert.match(candidateWorkflow, /needs:\n\s+- candidate\n\s+- publish/);
});
