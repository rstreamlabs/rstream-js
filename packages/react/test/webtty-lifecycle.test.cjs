// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const path = require("node:path");
const test = require("node:test");
const { build } = require("esbuild");
const { chromium } = require("playwright-core");
const protobuf = require("protobufjs");
const { WebSocketServer } = require("ws");

test("React terminals attach, stop explicitly and disconnect without disturbing other readers", { timeout: 30000 }, async (t) => {
  const message = protobuf.loadSync(path.join(__dirname, "../../webtty/protobuf/webtty.proto")).lookupType("rstream.webtty.protobuf.Message");
  const frames = [];
  const peers = new Map();
  const closed = [];
  const bundle = await build({
    stdin: {
      resolveDir: path.join(__dirname, ".."), loader: "tsx",
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { WebTTYTerminal } from "./src/components/webtty";
        window.connected = []; window.handles = {}; window.completed = []; window.output = [];
        const root = createRoot(document.getElementById("root"));
        const capabilities = { managed_protocol: true, explicit_termination: true };
        window.renderTerminals = (ids) => root.render(<>{ids.map((id) => <div key={id} style={{width: 600, height: 200}}>
          <WebTTYTerminal
            url={location.origin.replace("http:", "ws:")}
            attach={{ sessionId: id, participantId: id + "-reader", attachGrant: new TextEncoder().encode("fixture-grant") }}
            managed={{ capabilities: {...capabilities, explicit_termination: id !== "second"} }}
            allocateTty={false} interactive={false} sendHeartbeat={false}
            onConnect={() => window.connected.push(id)}
            onSessionReady={(session) => { window.handles[id] = session; }}
            onComplete={(code) => window.completed.push([id, code])}
            onStdout={(data) => window.output.push([id, new TextDecoder().decode(data)])}
          />
        </div>)}</>);
        window.renderTerminals(["first", "second"]);
      `,
    },
    bundle: true, write: false, outfile: "bundle.js", format: "iife", platform: "browser",
    define: { "process.env.NODE_ENV": '"development"' },
    loader: { ".css": "empty" },
  });
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`);
  });
  const sockets = new WebSocketServer({ server });
  const send = (socket, payload) => socket.send(message.encode(message.create(payload)).finish());
  sockets.on("connection", (socket) => {
    socket.on("message", (data) => {
      const frame = message.decode(data);
      frames.push(frame);
      if (frame.open || frame.attach) {
        const id = frame.attach?.sessionId ?? "unexpected-open-" + peers.size;
        peers.set(id, socket);
        socket.on("close", () => closed.push(id));
        send(socket, { ack: { managedSessionId: id, capabilities: [1] } });
      } else if (frame.terminate) {
        send(socket, { close: { returnCode: 23 } });
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    for (const peer of sockets.clients) peer.terminate();
    await new Promise((resolve) => sockets.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.connected.length === 2);
  assert.deepEqual(frames.map((frame) => frame.attach?.sessionId), ["first", "second"]);
  assert.equal(frames.some((frame) => frame.open), false);
  await page.waitForFunction(() => window.handles.first && window.handles.second);
  assert.deepEqual(await page.evaluate(() => [window.handles.first.canTerminate(), window.handles.second.canTerminate()]), [true, false]);
  await page.evaluate(() => window.handles.first.requestTermination());
  await page.waitForFunction(() => window.completed.length === 1);
  assert.deepEqual(await page.evaluate(() => window.completed), [["first", 23]]);
  send(peers.get("second"), { data: { type: 1, data: Buffer.from("still active") } });
  await page.waitForFunction(() => window.output.some(([id, value]) => id === "second" && value === "still active"));
  await page.evaluate(() => window.renderTerminals(["second", "third"]));
  await page.waitForFunction(() => window.handles.third);
  assert.deepEqual(frames.filter((frame) => frame.attach).map((frame) => frame.attach.sessionId), ["first", "second", "third"]);
  await page.evaluate(() => window.renderTerminals([]));
  await page.waitForFunction(() => document.querySelectorAll(".xterm").length === 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(frames.filter((frame) => frame.terminate).length, 1);
  assert.equal(frames.some((frame) => frame.open), false);
  assert.deepEqual(await page.evaluate(() => window.completed), [["first", 23]]);
  assert.deepEqual(errors, []);
  for (const id of ["second", "third"]) {
    if (!closed.includes(id)) await new Promise((resolve) => peers.get(id).once("close", resolve));
  }
});
