// See LICENSE file in the project root for license information.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const dist = new URL("packages/tunnels/dist/", root);

function build(command) {
  execSync(command, {
    cwd: root,
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function fingerprints() {
  return readdirSync(dist)
    .sort()
    .map((name) => [
      name,
      createHash("sha256")
        .update(readFileSync(new URL(name, dist)))
        .digest("hex"),
    ]);
}

test("rebuilding the tunnels SDK preserves every published distribution file", () => {
  build("npm run build -- --filter=@rstreamlabs/tunnels");
  const expected = fingerprints();
  assert.ok(expected.some(([name]) => name === "index.d.ts"));
  for (const attempt of [1, 2, 3]) {
    build("npm run build --workspace @rstreamlabs/tunnels");
    assert.deepEqual(
      fingerprints(),
      expected,
      `SDK files changed on rebuild ${attempt}`,
    );
  }
});
