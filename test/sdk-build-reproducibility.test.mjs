// See LICENSE file in the project root for license information.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);

function build(command) {
  execSync(command, {
    cwd: root,
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function fingerprints(dist) {
  return readdirSync(dist)
    .sort()
    .map((name) => [
      name,
      createHash("sha256")
        .update(readFileSync(new URL(name, dist)))
        .digest("hex"),
    ]);
}

for (const sdk of ["rstream", "tunnels"]) {
  test(`rebuilding the ${sdk} SDK preserves every published distribution file`, () => {
    const dist = new URL(`packages/${sdk}/dist/`, root);
    build(`npm run build -- --filter=@rstreamlabs/${sdk} --force`);
    const expected = fingerprints(dist);
    assert.ok(expected.some(([name]) => name === "index.d.ts"));
    assert.ok(expected.some(([name]) => name === "index.d.mts"));
    for (const attempt of [1, 2, 3]) {
      build(`npm run clean --workspace @rstreamlabs/${sdk}`);
      build(`npm run build --workspace @rstreamlabs/${sdk}`);
      assert.deepEqual(
        fingerprints(dist),
        expected,
        `${sdk} SDK files changed on clean rebuild ${attempt}`,
      );
    }
  });
}
