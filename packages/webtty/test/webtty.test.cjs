// See LICENSE file in the project root for license information.

const { executeWebTTYCommand } = require("../dist/index.js");
const { openWebTTYCommand } = require("../dist/index.js");
const { parseWebDAVMultiStatus } = require("../dist/index.js");
const { resolveWebTTYExecutionURL } = require("../dist/index.js");
const { resolveWebTTYFileSystemURL } = require("../dist/index.js");
const { runWebTTYCommand } = require("../dist/index.js");
const { WebTTY } = require("../dist/index.js");
const { WebTTYFileSystem } = require("../dist/index.js");
const { WebTTYRemoteExecutor } = require("../dist/index.js");
const assert = require("node:assert/strict");
const path = require("node:path");
const protobuf = require("protobufjs");
const test = require("node:test");

const root = protobuf.loadSync(
  path.join(__dirname, "../protobuf/webtty.proto"),
);
const Message = root.lookupType("rstream.webtty.protobuf.Message");

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.binaryType = "";
    this.closeCalls = 0;
    this.listeners = new Map();
    this.sent = [];
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type, callback) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }
  removeEventListener(type, callback) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => entry !== callback),
    );
  }
  send(payload) {
    this.sent.push(Buffer.from(payload));
  }
  close() {
    this.closeCalls += 1;
  }
  dispatch(type, event = {}) {
    for (const callback of this.listeners.get(type) ?? []) {
      callback(event);
    }
  }
}

function encode(payload) {
  return Message.encode(Message.create(payload)).finish();
}

function decode(payload) {
  return Message.decode(payload);
}

function withFakeWebSocket(callback) {
  const original = global.WebSocket;
  FakeWebSocket.instances = [];
  global.WebSocket = FakeWebSocket;
  try {
    callback();
  } finally {
    global.WebSocket = original;
  }
}

async function withAsyncFakeWebSocket(callback) {
  const original = global.WebSocket;
  FakeWebSocket.instances = [];
  global.WebSocket = FakeWebSocket;
  try {
    await callback();
  } finally {
    global.WebSocket = original;
  }
}

function acknowledge(ws) {
  ws.dispatch("open");
  ws.dispatch("message", { data: encode({ ack: {} }) });
  return ws;
}

async function firstFakeWebSocket(attempts = 10) {
  if (FakeWebSocket.instances[0]) return FakeWebSocket.instances[0];
  if (attempts === 0) throw new Error("WebSocket was not created.");
  await Promise.resolve();
  return firstFakeWebSocket(attempts - 1);
}

function connect(client) {
  client.connect();
  return acknowledge(FakeWebSocket.instances[0]);
}

async function collectAsync(iterator, entries = []) {
  const result = await iterator.next();
  return result.done
    ? entries
    : collectAsync(iterator, [...entries, result.value]);
}

async function readStreamText(stream) {
  const reader = stream.getReader();
  const chunks = await readStreamChunks(reader);
  reader.releaseLock();
  return Buffer.concat(chunks).toString();
}

async function readStreamChunks(reader, chunks = []) {
  const result = await reader.read();
  return result.done
    ? chunks
    : readStreamChunks(reader, [...chunks, result.value]);
}

function textStream(value) {
  return new ReadableStream({
    start: (controller) => {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}

test("WebTTY opens a protobuf session and sends interactive client messages", () => {
  withFakeWebSocket(() => {
    const connected = [];
    const client = new WebTTY(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      {
        cmdArgs: ["bash", "-lc", "id"],
        envVars: [{ key: "TERM", value: "xterm-256color" }],
        username: "alice",
        workdir: "/srv/app",
      },
      { onConnect: () => connected.push(true) },
    );
    const ws = connect(client);
    assert.equal(ws.url, "wss://terminal.example.test/session");
    assert.equal(ws.binaryType, "arraybuffer");
    const open = decode(ws.sent[0]);
    assert.deepEqual(open.open.config.cmdArgs, ["bash", "-lc", "id"]);
    assert.deepEqual(
      open.open.config.envVars.map((entry) => entry.toJSON()),
      [{ key: "TERM", value: "xterm-256color" }],
    );
    assert.equal(open.open.config.options.interactive, true);
    assert.equal(open.open.config.options.allocateTty, true);
    assert.equal(open.open.config.options.sendHeartbeat, false);
    assert.equal(open.open.config.username.name, "alice");
    assert.equal(open.open.config.workdir.value, "/srv/app");
    assert.deepEqual(connected, [true]);
    client.writeStdin(new Uint8Array([65, 66]));
    assert.deepEqual(Array.from(decode(ws.sent[1]).data.data), [65, 66]);
    client.closeStdin();
    assert.ok(decode(ws.sent[2]).data.eos);
    client.resize(24, 80, 800, 600);
    assert.deepEqual(decode(ws.sent[3]).parameter.terminalSize.toJSON(), {
      col: 80,
      row: 24,
      xpixel: 800,
      ypixel: 600,
    });
  });
});

test("WebTTY ignores explicit undefined options when applying defaults", () => {
  withFakeWebSocket(() => {
    const client = new WebTTY(
      {
        heartbeatIntervalMs: undefined,
        sendHeartbeat: undefined,
        url: "wss://terminal.example.test/session",
      },
      {
        allocateTty: undefined,
        envVars: undefined,
        interactive: undefined,
      },
    );
    const ws = connect(client);
    const open = decode(ws.sent[0]);
    assert.deepEqual(open.open.config.envVars, []);
    assert.equal(open.open.config.options.interactive, true);
    assert.equal(open.open.config.options.allocateTty, true);
    assert.equal(open.open.config.options.sendHeartbeat, true);
    client.disconnect();
  });
});

test("WebTTY dispatches stdout stderr EOS and remote close events exactly once", () => {
  withFakeWebSocket(() => {
    const events = [];
    const client = new WebTTY(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      undefined,
      {
        onComplete: (code) => events.push(["complete", code]),
        onStderr: (chunk) =>
          events.push(["stderr", Buffer.from(chunk).toString()]),
        onStderrEos: () => events.push(["stderr-eos"]),
        onStdout: (chunk) =>
          events.push(["stdout", Buffer.from(chunk).toString()]),
        onStdoutEos: () => events.push(["stdout-eos"]),
      },
    );
    const ws = connect(client);
    ws.dispatch("message", {
      data: encode({ data: { data: Buffer.from("out"), type: 1 } }),
    });
    ws.dispatch("message", { data: encode({ data: { eos: {}, type: 1 } }) });
    ws.dispatch("message", {
      data: encode({ data: { data: Buffer.from("err"), type: 2 } }),
    });
    ws.dispatch("message", { data: encode({ data: { eos: {}, type: 2 } }) });
    ws.dispatch("message", { data: encode({ close: { returnCode: 7 } }) });
    ws.dispatch("close");
    assert.deepEqual(events, [
      ["stdout", "out"],
      ["stdout-eos"],
      ["stderr", "err"],
      ["stderr-eos"],
      ["complete", 7],
    ]);
    assert.equal(ws.closeCalls, 1);
  });
});

test("WebTTY fails closed for invalid states and malformed server messages", () => {
  withFakeWebSocket(() => {
    const errors = [];
    const client = new WebTTY(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      { allocateTty: false, interactive: false },
      { onError: (error) => errors.push(error) },
    );
    assert.throws(
      () => client.writeStdin(new Uint8Array([1])),
      /Invalid state/,
    );
    const ws = connect(client);
    assert.throws(() => client.writeStdin(new Uint8Array([1])), /STDIN/);
    assert.throws(() => client.closeStdin(), /STDIN/);
    assert.throws(() => client.resize(24, 80), /Resize/);
    ws.dispatch("message", { data: Buffer.from([255]) });
    assert.match(errors[0], /^Failed to decode message:/);
  });
});

test("WebTTY closes unexpected pre-ACK data instead of processing it", () => {
  withFakeWebSocket(() => {
    const errors = [];
    const client = new WebTTY(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      undefined,
      { onError: (error) => errors.push(error) },
    );
    client.connect();
    const ws = FakeWebSocket.instances[0];
    ws.dispatch("open");
    ws.dispatch("message", {
      data: encode({ data: { data: Buffer.from("early"), type: 1 } }),
    });
    assert.deepEqual(errors, ["Unexpected data message."]);
    assert.equal(ws.closeCalls, 1);
  });
});

test("executeWebTTYCommand runs non-interactive commands and collects output", async () => {
  await withAsyncFakeWebSocket(async () => {
    const command = executeWebTTYCommand(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      { cmdArgs: ["sh", "-lc", "printf ok"] },
    );
    const ws = acknowledge(FakeWebSocket.instances[0]);
    const open = decode(ws.sent[0]);
    assert.deepEqual(open.open.config.cmdArgs, ["sh", "-lc", "printf ok"]);
    assert.equal(open.open.config.options.interactive, false);
    assert.equal(open.open.config.options.allocateTty, false);
    ws.dispatch("message", {
      data: encode({ data: { data: Buffer.from("ok"), type: 1 } }),
    });
    ws.dispatch("message", {
      data: encode({ data: { data: Buffer.from("warn"), type: 2 } }),
    });
    ws.dispatch("message", { data: encode({ close: { returnCode: 0 } }) });
    assert.deepEqual(await command, {
      exitCode: 0,
      stderr: "warn",
      stdout: "ok",
      success: true,
    });
  });
});

test("openWebTTYCommand exposes replayable logs streams stdin and wait", async () => {
  await withAsyncFakeWebSocket(async () => {
    const command = openWebTTYCommand(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      { cmdArgs: ["cat"], interactive: true },
    );
    const logs = collectAsync(command.logs());
    const ws = acknowledge(await firstFakeWebSocket());
    await command.writeStdin("payload");
    await command.closeStdin();
    assert.equal(
      Buffer.from(decode(ws.sent[1]).data.data).toString(),
      "payload",
    );
    assert.ok(decode(ws.sent[2]).data.eos);
    ws.dispatch("message", {
      data: encode({ data: { data: Buffer.from("out"), type: 1 } }),
    });
    ws.dispatch("message", {
      data: encode({ data: { data: Buffer.from("err"), type: 2 } }),
    });
    ws.dispatch("message", { data: encode({ close: { returnCode: 3 } }) });
    assert.deepEqual(await command.wait(), { exitCode: 3, success: false });
    assert.equal(await command.stdout(), "out");
    assert.equal(await command.stderr(), "err");
    assert.equal(await command.output("both"), "outerr");
    assert.deepEqual(await logs, [
      { data: "out", stream: "stdout" },
      { data: "err", stream: "stderr" },
    ]);
  });
});

test("runWebTTYCommand maps command args cwd env stdin and exec path", async () => {
  await withAsyncFakeWebSocket(async () => {
    const execution = runWebTTYCommand(
      { sendHeartbeat: false, url: "https://terminal.example.test/base" },
      "sh",
      ["-lc", "printf $CUSTOM"],
      {
        cwd: "/srv/app",
        env: { CUSTOM: "value", SKIP: undefined },
        execPath: "/exec",
        stdin: "input",
      },
    );
    const ws = acknowledge(await firstFakeWebSocket());
    const open = decode(ws.sent[0]);
    assert.equal(ws.url, "wss://terminal.example.test/base/exec");
    assert.deepEqual(open.open.config.cmdArgs, ["sh", "-lc", "printf $CUSTOM"]);
    assert.deepEqual(
      open.open.config.envVars.map((entry) => entry.toJSON()),
      [{ key: "CUSTOM", value: "value" }],
    );
    assert.equal(open.open.config.workdir.value, "/srv/app");
    assert.equal(Buffer.from(decode(ws.sent[1]).data.data).toString(), "input");
    ws.dispatch("message", {
      data: encode({ data: { data: Buffer.from("value"), type: 1 } }),
    });
    ws.dispatch("message", { data: encode({ close: { returnCode: 0 } }) });
    assert.deepEqual(await execution, {
      exitCode: 0,
      stderr: "",
      stdout: "value",
      success: true,
    });
  });
});

test("WebTTYCommand kill closes the session and settles waiters", async () => {
  await withAsyncFakeWebSocket(async () => {
    const command = openWebTTYCommand(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      { cmdArgs: ["sleep", "30"] },
    );
    const ws = acknowledge(await firstFakeWebSocket());
    await command.kill();
    assert.equal(ws.closeCalls, 1);
    await assert.rejects(() => command.wait(), /Session terminated by client/);
  });
});

test("WebTTYRemoteExecutor resolves URLs lazily and sends command input", async () => {
  await withAsyncFakeWebSocket(async () => {
    const executor = new WebTTYRemoteExecutor({
      execPath: "/exec",
      sendHeartbeat: false,
      url: async () => "https://terminal.example.test",
    });
    const command = executor.execute({
      cmdArgs: ["cat"],
      input: "payload",
    });
    const ws = acknowledge(await firstFakeWebSocket());
    assert.equal(ws.url, "wss://terminal.example.test/exec");
    const open = decode(ws.sent[0]);
    assert.equal(open.open.config.options.interactive, true);
    assert.equal(
      Buffer.from(decode(ws.sent[1]).data.data).toString(),
      "payload",
    );
    assert.ok(decode(ws.sent[2]).data.eos);
    ws.dispatch("message", { data: encode({ close: { returnCode: 0 } }) });
    assert.deepEqual(await command, {
      exitCode: 0,
      stderr: "",
      stdout: "",
      success: true,
    });
  });
});

test("resolveWebTTYExecutionURL maps published URLs to discovered exec paths", () => {
  assert.equal(
    resolveWebTTYExecutionURL("https://shell.example").toString(),
    "wss://shell.example/",
  );
  assert.equal(
    resolveWebTTYExecutionURL(
      "wss://shell.example/base?x=1",
      "/exec",
    ).toString(),
    "wss://shell.example/base/exec?x=1",
  );
  assert.throws(
    () => resolveWebTTYExecutionURL("rstrm://shell", "/exec"),
    /native rstream dialer/,
  );
});

test("executeWebTTYCommand reports timeouts clearly", async () => {
  await withAsyncFakeWebSocket(async () => {
    await assert.rejects(
      () =>
        executeWebTTYCommand(
          { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
          { cmdArgs: ["sleep", "10"], timeoutMs: 0 },
        ),
      /timed out/,
    );
  });
});

test("resolveWebTTYFileSystemURL maps WebTTY URLs to the filesystem sidecar", () => {
  assert.equal(
    resolveWebTTYFileSystemURL("wss://shell.example").toString(),
    "https://shell.example/fs",
  );
  assert.equal(
    resolveWebTTYFileSystemURL(
      "https://shell.example/base?x=1",
      "/dir/file with space.txt",
    ).toString(),
    "https://shell.example/base/fs/dir/file%20with%20space.txt?x=1",
  );
  assert.equal(
    resolveWebTTYFileSystemURL(
      "https://shell.example/base?x=1",
      "/dir/file.txt",
      "/dav",
    ).toString(),
    "https://shell.example/base/dav/dir/file.txt?x=1",
  );
  assert.throws(
    () => resolveWebTTYFileSystemURL("rstrm://shell"),
    /native rstream dialer/,
  );
});

test("WebTTYFileSystem sends WebDAV requests and parses directory listings", async () => {
  const calls = [];
  const fs = new WebTTYFileSystem({
    authToken: "token",
    fetch: async (input, init) => {
      calls.push({
        authorization: init.headers.get("Authorization"),
        body: init.body,
        depth: init.headers.get("Depth"),
        method: init.method,
        url: input.toString(),
      });
      if (init.method === "PROPFIND") {
        return new Response(
          `<?xml version="1.0" encoding="utf-8"?>
          <D:multistatus xmlns:D="DAV:">
            <D:response>
              <D:href>/dav/</D:href>
              <D:propstat>
                <D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop>
                <D:status>HTTP/1.1 200 OK</D:status>
              </D:propstat>
            </D:response>
            <D:response>
              <D:href>/dav/file.txt</D:href>
              <D:propstat>
                <D:prop><D:getcontentlength>12</D:getcontentlength><D:getlastmodified>today</D:getlastmodified></D:prop>
                <D:status>HTTP/1.1 200 OK</D:status>
              </D:propstat>
            </D:response>
          </D:multistatus>`,
          { status: 207 },
        );
      }
      return new Response("ok", { status: 200 });
    },
    fsPath: "/dav",
    url: "https://shell.example",
  });
  assert.deepEqual(await fs.list("/"), [
    { kind: "directory", modified: undefined, path: "/", size: undefined },
    { kind: "file", modified: "today", path: "/file.txt", size: 12 },
  ]);
  await fs.writeText("/file.txt", "next");
  await fs.delete("/file.txt");
  assert.deepEqual(
    calls.map((call) => call.method),
    ["PROPFIND", "PUT", "DELETE"],
  );
  assert.equal(calls[0].authorization, "Bearer token");
  assert.equal(calls[0].depth, "1");
  assert.equal(calls[1].url, "https://shell.example/dav/file.txt");
});

test("WebTTYFileSystem exposes fs-style helpers and stream APIs", async () => {
  const calls = [];
  const fs = new WebTTYFileSystem({
    fetch: async (input, init) => {
      calls.push({
        body: init.body,
        destination: init.headers.get("Destination"),
        duplex: init.duplex,
        method: init.method,
        type: init.headers.get("Content-Type"),
        url: input.toString(),
      });
      if (init.method === "GET") return new Response("hello", { status: 200 });
      if (init.method === "PROPFIND") {
        return new Response(
          `<?xml version="1.0" encoding="utf-8"?>
          <D:multistatus xmlns:D="DAV:">
            <D:response>
              <D:href>/fs/dir</D:href>
              <D:propstat>
                <D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop>
                <D:status>HTTP/1.1 200 OK</D:status>
              </D:propstat>
            </D:response>
            <D:response>
              <D:href>/fs/dir/file.txt</D:href>
              <D:propstat>
                <D:prop><D:getcontentlength>5</D:getcontentlength></D:prop>
                <D:status>HTTP/1.1 200 OK</D:status>
              </D:propstat>
            </D:response>
          </D:multistatus>`,
          { status: 207 },
        );
      }
      if (init.method === "MKCOL") return new Response(null, { status: 201 });
      return new Response(null, { status: 204 });
    },
    url: "https://shell.example",
  });
  assert.equal(await fs.readFile("/hello.txt", "utf-8"), "hello");
  assert.equal(
    await readStreamText(await fs.readStream("/hello.txt")),
    "hello",
  );
  await fs.writeFile("/hello.txt", "updated");
  await fs.writeStream("/stream.txt", textStream("stream"), {
    contentType: "application/octet-stream",
  });
  await fs.mkdir("/dir", { recursive: true });
  assert.deepEqual(await fs.readdir("/dir"), ["file.txt"]);
  await fs.rename("/old.txt", "/new.txt");
  await fs.copyFile("/new.txt", "/copy.txt");
  await fs.rm("/new.txt", { force: true });
  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET", "GET", "PUT", "PUT", "MKCOL", "PROPFIND", "MOVE", "COPY", "DELETE"],
  );
  assert.equal(calls[3].type, "application/octet-stream");
  assert.equal(calls[3].duplex, "half");
  assert.equal(calls[6].destination, "https://shell.example/fs/new.txt");
  assert.equal(calls[7].destination, "https://shell.example/fs/copy.txt");
});

test("parseWebDAVMultiStatus ignores non-200 propstats", () => {
  assert.deepEqual(
    parseWebDAVMultiStatus(
      `
      <D:multistatus xmlns:D="DAV:">
        <D:response>
          <D:href>/dav/hidden.txt</D:href>
          <D:propstat>
            <D:prop><D:getcontentlength>9</D:getcontentlength></D:prop>
            <D:status>HTTP/1.1 404 Not Found</D:status>
          </D:propstat>
        </D:response>
      </D:multistatus>
    `,
      "/dav",
    ),
    [],
  );
});
