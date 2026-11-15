// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const execute = promisify(execFile);

for (const operation of ["create", "close"]) {
  test(`control loss before the ${operation} write completes remains a handled caller rejection`, async () => {
    const result = await execute(
      process.execPath,
      [
        "--unhandled-rejections=strict",
        path.join(__dirname, "fixtures/pending-operation-runtime.cjs"),
        operation,
      ],
      { timeout: 5000 },
    );
    assert.match(result.stdout, /caller received ERR_RSTREAM_CONTROL_CLOSED/);
  });
}
