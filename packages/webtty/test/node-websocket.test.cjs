// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const test = require("node:test");
const execute = promisify(execFile);

test(
  "Node WebSocket TLS, concurrency, payload and cancellation runtime",
  { timeout: 30_000 },
  async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "webtty-node-tls-"),
    );
    try {
      await execute(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "ec",
          "-pkeyopt",
          "ec_paramgen_curve:P-256",
          "-nodes",
          "-keyout",
          path.join(directory, "key.pem"),
          "-out",
          path.join(directory, "cert.pem"),
          "-days",
          "1",
          "-subj",
          "/CN=localhost",
          "-addext",
          "subjectAltName=DNS:localhost,IP:127.0.0.1",
        ],
        { timeout: 10_000, maxBuffer: 64 * 1024 },
      );
      const result = await execute(
        process.execPath,
        ["--test", path.join(__dirname, "fixtures/node-websocket-runtime.cjs")],
        {
          env: {
            ...process.env,
            NODE_TEST_CONTEXT: undefined,
            WEBTTY_NODE_TLS_FIXTURE: directory,
            NODE_EXTRA_CA_CERTS: path.join(directory, "cert.pem"),
          },
          timeout: 20_000,
          maxBuffer: 256 * 1024,
        },
      );
      assert.match(result.stdout, /tests 4(?:\r?\n|$)/);
      assert.match(result.stdout, /pass 4(?:\r?\n|$)/);
      assert.match(result.stdout, /fail 0(?:\r?\n|$)/);
      assert.match(result.stdout, /skipped 0(?:\r?\n|$)/);
      assert.match(result.stdout, /cancelled 0(?:\r?\n|$)/);
    } finally {
      await fs.rm(directory, { force: true, recursive: true });
    }
  },
);
