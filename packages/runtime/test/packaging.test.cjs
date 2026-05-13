// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function runNode(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `${result.stderr}\n${result.stdout}`.trim(),
  );
}

test("distribution ESM entrypoint is importable by Node.js", () => {
  runNode([
    "--input-type=module",
    "--eval",
    'import("./dist/index.mjs").then((m) => { if (typeof m.Client !== "function") throw new Error("Client export missing"); })',
  ]);
});

test("distribution CommonJS entrypoint is requireable by Node.js", () => {
  runNode([
    "--eval",
    'const m = require("./dist/index.js"); if (typeof m.Client !== "function") throw new Error("Client export missing");',
  ]);
});
