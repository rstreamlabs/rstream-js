// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const http2 = require("node:http2");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");
const { build } = require("esbuild");
const protobuf = require("protobufjs");
const { WebSocketServer } = require("ws");

const execute = promisify(execFile);

test(
  "the remote-command example owns its verified Node WebSocket transport",
  { timeout: 30000 },
  async (t) => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "webtty-node-example-"),
    );
    t.after(() => fs.rm(directory, { force: true, recursive: true }));
    const certificate = path.join(directory, "ca.pem");
    const key = path.join(directory, "key.pem");
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
        key,
        "-out",
        certificate,
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ],
      { timeout: 10000 },
    );
    const program = path.join(directory, "example.cjs");
    await build({
      entryPoints: [
        path.join(__dirname, "../examples/remote-command/src/main.ts"),
      ],
      outfile: program,
      bundle: true,
      platform: "node",
      format: "cjs",
      // The example must use its explicit adapter even without an ambient web API.
      banner: { js: "globalThis.WebSocket = undefined;" },
      plugins: [
        {
          name: "fixture-environment",
          setup(builder) {
            builder.onResolve({ filter: /^dotenv$/ }, () => ({
              path: "dotenv",
              namespace: "fixture",
            }));
            builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
              contents: "export default { config() {} };",
              loader: "js",
            }));
          },
        },
      ],
    });
    const Message = protobuf
      .loadSync(path.join(__dirname, "../protobuf/webtty.proto"))
      .lookupType("rstream.webtty.protobuf.Message");
    const server = http2.createSecureServer({
      key: await fs.readFile(key),
      cert: await fs.readFile(certificate),
      allowHTTP1: true,
      settings: { enableConnectProtocol: true },
    });
    const sockets = new Set();
    const protocols = [];
    const commands = [];
    const webSockets = new WebSocketServer({ noServer: true });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.on("close", () => sockets.delete(socket));
    });
    server.on("stream", (stream) => {
      protocols.push("h2");
      stream.close();
    });
    server.on("upgrade", (request, socket, head) => {
      protocols.push(request.httpVersion);
      webSockets.handleUpgrade(request, socket, head, (ws) =>
        ws.on("message", (bytes) => {
          const message = Message.decode(bytes);
          if (!message.open) return;
          commands.push(message.open);
          const send = (value) =>
            ws.send(Message.encode(Message.create(value)).finish());
          send({ ack: {} });
          send({
            data: {
              type: 1,
              data: Buffer.from(
                commands.length === 1
                  ? "fixture-output\n"
                  : "tick:1\ntick:2\ntick:3\n",
              ),
            },
          });
          send({ close: { returnCode: 0 } });
        }),
      );
    });
    t.after(async () => {
      for (const socket of webSockets.clients) socket.terminate();
      for (const socket of sockets) socket.destroy();
      await Promise.all([
        new Promise((resolve) => webSockets.close(resolve)),
        new Promise((resolve) => server.close(resolve)),
      ]);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const result = await execute(process.execPath, [program], {
      cwd: directory,
      env: {
        PATH: process.env.PATH,
        NODE_EXTRA_CA_CERTS: certificate,
        RSTREAM_WEBTTY_URL: `wss://127.0.0.1:${server.address().port}/?rstream.token=synthetic-fixture`,
      },
      timeout: 15000,
      maxBuffer: 131072,
    });
    assert.equal(
      commands.length,
      2,
      "both collected and streaming commands must complete",
    );
    assert.deepEqual(
      protocols,
      ["1.1", "1.1"],
      "the Node adapter must keep RFC 6455 on HTTP/1.1 even when the server offers H2",
    );
    assert.match(result.stdout, /fixture-output/);
    assert.match(result.stdout, /tick:3/);
    assert.doesNotMatch(result.stdout, /synthetic-fixture/);
  },
);
