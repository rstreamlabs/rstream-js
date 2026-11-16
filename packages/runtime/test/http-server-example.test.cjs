// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");
const { build } = require("esbuild");

const execute = promisify(execFile);
const fixture = `
const events = [];
const pending = {};
const scenario = process.env.EXAMPLE_LIFECYCLE_CASE;
const stop = () => { process.emit("SIGINT"); process.emit("SIGTERM"); };
process.on("exit", () => console.log("LIFECYCLE " + JSON.stringify(events)));
const tunnel = {
  forwardingAddress: async () => "https://example.test",
  close: async () => { events.push("tunnel.close"); },
  serve: async (server) => {
    events.push("serve");
    const close = server.close.bind(server);
    server.close = (...args) => { events.push("server.close"); return close(...args); };
    if (scenario === "signal-serve") stop();
  },
};
const control = {
  createTunnel: async () => {
    events.push("create");
    if (scenario === "create-error") throw new Error("fixture create failure");
    if (scenario === "signal-create") return await new Promise((_, reject) => {
      pending.reject = reject;
      queueMicrotask(stop);
      setTimeout(() => reject(new Error("fixture create still pending after signals")), 50);
    });
    return tunnel;
  },
  close: async () => {
    events.push("control.close");
    pending.reject?.(new Error("fixture control closed"));
  },
};
export class Client {
  static fromEnv() { return new Client(); }
  async connect(options) {
    events.push("connect");
    if (scenario === "connect-error") throw new Error("fixture connect failure");
    if (scenario === "signal-connect") {
      stop();
      if (options?.signal?.aborted) throw new Error("fixture connection cancelled");
    }
    return control;
  }
  async close() { events.push("client.close"); }
}
`;

test("HTTP example owns cleanup through setup failures and repeated stop requests", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "runtime-http-lifecycle-"),
  );
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  const program = path.join(directory, "example.mjs");
  await build({
    entryPoints: [path.join(__dirname, "../examples/http-server/src/main.ts")],
    outfile: program,
    bundle: true,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "owned-lifecycle-fixture",
        setup(builder) {
          builder.onResolve({ filter: /^@rstreamlabs\/runtime$/ }, () => ({
            path: "runtime",
            namespace: "fixture",
          }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: fixture,
            loader: "js",
          }));
        },
      },
    ],
  });
  for (const [scenario, expectedExit, expectedEvents] of [
    ["connect-error", 1, ["connect", "client.close"]],
    ["create-error", 1, ["connect", "create", "control.close", "client.close"]],
    [
      "normal",
      0,
      [
        "connect",
        "create",
        "serve",
        "server.close",
        "tunnel.close",
        "control.close",
        "client.close",
      ],
    ],
    ["signal-connect", 0, ["connect", "client.close"]],
    [
      "signal-create",
      0,
      ["connect", "create", "control.close", "client.close"],
    ],
    [
      "signal-serve",
      0,
      [
        "connect",
        "create",
        "serve",
        "control.close",
        "server.close",
        "tunnel.close",
        "client.close",
      ],
    ],
  ]) {
    await t.test(scenario, async () => {
      const result = await execute(process.execPath, [program], {
        cwd: directory,
        env: { PATH: process.env.PATH, EXAMPLE_LIFECYCLE_CASE: scenario },
        timeout: 3000,
      }).then(
        (value) => ({ ...value, code: 0 }),
        (error) => error,
      );
      const match = result.stdout?.match(/^LIFECYCLE (.*)$/m);
      assert.ok(match, result.stderr);
      const events = JSON.parse(match[1]);
      assert.deepEqual(
        events.toSorted(),
        expectedEvents.toSorted(),
        "only acquired resources close, exactly once",
      );
      assert.equal(
        events.at(-1),
        "client.close",
        "the client closes after its resources",
      );
      assert.equal(result.code, expectedExit, result.stderr);
    });
  }
});
