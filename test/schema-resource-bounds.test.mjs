import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

for (const name of ["filesystem", "rstream", "tunnels"]) {
  test(`${name} rejects oversized collections before validating elements`, () => {
    const require = createRequire(
      new URL(`../packages/${name}/package.json`, import.meta.url),
    );
    const { z } = require("zod");
    const visited = [];
    const item = z.string().superRefine((value) => visited.push(value));
    const result = z.array(item).max(4).safeParse(Array(1000).fill("value"));
    assert.equal(result.success, false);
    assert.equal(visited.length, 0);
    assert.equal(result.error.issues.length, 1);
    assert.equal(result.error.issues[0].code, "too_big");
    assert.deepEqual(z.array(item).max(4).parse(["valid"]), ["valid"]);
    assert.deepEqual(visited, ["valid"]);
  });
}
