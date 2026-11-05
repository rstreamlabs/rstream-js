// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const path = require("node:path");
const test = require("node:test");
const { build } = require("esbuild");
const { chromium } = require("playwright-core");
const protobuf = require("protobufjs");
const { WebSocketServer } = require("ws");

async function fixture(t) {
  const message = protobuf
    .loadSync(path.join(__dirname, "../../webtty/protobuf/webtty.proto"))
    .lookupType("rstream.webtty.protobuf.Message");
  const grants = new Map();
  const connections = [];
  const rejected = [];
  let now = Date.now();
  let nextGrant = 0;
  const bundle = await build({
    stdin: {
      resolveDir: path.join(__dirname, ".."),
      loader: "tsx",
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { WebTTYWorkspace } from "./src/workspace";
        import { normalizeWebTTYTerminalError, redactWebTTYConnectionCredentials } from "./src/webtty-errors";
        window.normalize = normalizeWebTTYTerminalError;
        window.redact = redactWebTTYConnectionCredentials;
        const root = createRoot(document.getElementById("root"));
        const Button = ({variant, ...props}) => <button {...props} />;
        window.calls = []; window.errors = []; window.held = [];
        window.hold = false;
        const provider = (name) => async (signal) => {
          const call = {name, aborted: signal.aborted};
          window.calls.push(call);
          signal.addEventListener("abort", () => { call.aborted = true; }, {once: true});
          const response = await fetch("/grant");
          const { token } = await response.json();
          // Deliberately ignore abort: the workspace must reject stale results too.
          if (window.hold) await new Promise((resolve, reject) => window.held.push({resolve, reject}));
          return { url: location.origin.replace("http:", "ws:") + "/?rstream.token=" + token, transport: "websocket" };
        };
        const providers = { first: provider("first"), second: provider("second") };
        window.renderWorkspace = (options = {}) => root.render(<React.StrictMode>
          <WebTTYWorkspace style={{width: 600, height: 300}} Button={Button}
            prepareSession={options.noProvider ? undefined : providers[options.provider ?? "first"]}
            terminalBlockedMessage={options.blocked ? "Access revoked" : undefined}
            displayOnly={options.displayOnly}
            onPreparationError={(error) => window.errors.push(error)} />
        </React.StrictMode>);
        window.unmountWorkspace = () => root.render(null);
      `,
    },
    bundle: true,
    write: false,
    outfile: "bundle.js",
    format: "iife",
    platform: "browser",
    define: { "process.env.NODE_ENV": '"development"' },
    loader: { ".css": "empty" },
  });
  const server = createServer((req, res) => {
    if (req.url === "/grant") {
      const token = `grant-${++nextGrant}`;
      grants.set(token, now + 60000);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ token }));
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`,
    );
  });
  const sockets = new WebSocketServer({
    server,
    verifyClient: ({ req }) => {
      const token = new URL(req.url, "http://localhost").searchParams.get(
        "rstream.token",
      );
      const allowed = grants.has(token) && grants.get(token) > now;
      if (!allowed) rejected.push(token);
      return allowed;
    },
  });
  sockets.on("connection", (socket, req) => {
    const token = new URL(req.url, "http://localhost").searchParams.get(
      "rstream.token",
    );
    socket.on("message", (data) => {
      const frame = message.decode(data);
      if (frame.open) {
        connections.push({ token, socket });
        socket.send(message.encode(message.create({ ack: {} })).finish());
      }
    });
  });
  let browser;
  t.after(async () => {
    await browser?.close();
    for (const socket of sockets.clients) socket.terminate();
    await new Promise((resolve) => sockets.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  return {
    page,
    connections,
    rejected,
    pageErrors,
    expire: () => {
      now += 60001;
    },
  };
}

const connected = (page, count) =>
  page.waitForFunction(
    (expected) =>
      document.querySelectorAll('[role="tab"] [aria-label="connected"]')
        .length === expected,
    count,
  );

test(
  "new tabs authorize after expiry; switching, capacity and closing preserve session ownership",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const { page } = f;
    await page.evaluate(() => window.renderWorkspace());
    await connected(page, 1);
    assert.equal(f.connections.length, 1, "StrictMode opens only one session");
    f.expire();
    await page
      .getByRole("button", { name: "New terminal", exact: true })
      .click();
    await connected(page, 2);
    assert.notEqual(f.connections[0].token, f.connections[1].token);
    assert.deepEqual(f.rejected, []);
    await page.getByRole("tab", { name: /Terminal 1$/, exact: true }).click();
    assert.equal(f.connections.length, 2, "tab selection must not reconnect");
    for (let count = 3; count <= 5; count++) {
      await page
        .getByRole("button", { name: "New terminal", exact: true })
        .click();
      await connected(page, count);
    }
    assert.equal(
      await page
        .getByRole("button", { name: "New terminal", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(f.connections.length, 5);
    await page
      .getByRole("button", { name: "Close Terminal 3", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll('[role="tab"]').length === 4,
    );
    assert.equal(
      await page
        .getByRole("tab", { name: /Terminal 5$/, exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    await page
      .getByRole("button", { name: "Close Terminal 5", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("tab", { name: /Terminal 4$/, exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    for (const id of [1, 2, 4])
      await page
        .getByRole("button", { name: `Close Terminal ${id}`, exact: true })
        .click();
    await page.waitForFunction(() => !document.querySelector('[role="tab"]'));
    assert.equal(
      f.connections.length,
      5,
      "closing the final tab does not auto-open another",
    );
    assert.deepEqual(f.pageErrors, []);
  },
);

test(
  "cancelled preparation, changed authorization and unmount discard late results",
  { timeout: 30000 },
  async (t) => {
    const { page, connections, pageErrors } = await fixture(t);
    await page.evaluate(() => {
      window.hold = true;
      window.renderWorkspace();
    });
    await page.waitForFunction(() => window.held.length === 2);
    await page.evaluate(() => window.renderWorkspace({ blocked: true }));
    await page.waitForFunction(() =>
      window.calls.every((call) => call.aborted),
    );
    await page.evaluate(() =>
      window.held.splice(0).forEach(({ resolve }) => resolve()),
    );
    await page.evaluate(() => window.renderWorkspace({ provider: "second" }));
    await page.waitForFunction(() => window.held.length === 1);
    await page.evaluate(() => window.held.shift().resolve());
    await connected(page, 1);
    assert.equal(connections.length, 1);
    await page.evaluate(() => {
      const button = document.querySelector('[aria-label="New terminal"]');
      button.click();
      button.click();
      button.click();
    });
    await page.waitForFunction(() => window.held.length === 1);
    assert.equal(
      await page.evaluate(
        () => window.calls.filter((call) => call.name === "second").length,
      ),
      2,
    );
    await page.evaluate(() => window.unmountWorkspace());
    await page.waitForFunction(() => window.calls.at(-1).aborted);
    await page.evaluate(() => window.held.shift().resolve());
    assert.equal(connections.length, 1);
    assert.deepEqual(await page.evaluate(() => window.errors), []);
    assert.deepEqual(pageErrors, []);
  },
);

test(
  "display-only rendering, recoverable preparation errors and safe diagnostics",
  { timeout: 30000 },
  async (t) => {
    const { page, pageErrors } = await fixture(t);
    await page.evaluate(() => window.renderWorkspace({ displayOnly: true }));
    await page.waitForFunction(
      () => document.querySelector('[aria-label="New terminal"]')?.disabled,
    );
    assert.equal(await page.evaluate(() => window.calls.length), 0);
    await page.evaluate(() => {
      window.hold = true;
      window.renderWorkspace();
    });
    await page.waitForFunction(() => window.held.length === 1);
    await page.evaluate(() =>
      window.held
        .shift()
        .reject(
          new Error("Denied wss://example.test/?rstream.token=secret-grant"),
        ),
    );
    await page.waitForFunction(() => window.errors.length === 1);
    assert.equal(
      await page.evaluate(() => window.errors[0]),
      "Denied wss://example.test/?rstream.token=[redacted]",
    );
    await page.evaluate(() => {
      window.hold = false;
    });
    await page
      .getByRole("button", { name: "New terminal", exact: true })
      .click();
    await connected(page, 1);
    assert.equal(
      await page.evaluate(() =>
        window.normalize("WebSocket error", { expectsAuthenticatedE2E: true }),
      ),
      "WebSocket error",
    );
    assert.equal(
      await page.evaluate(() => window.redact("bad", "invalid-url")),
      "Connection failed: invalid endpoint URL.",
    );
    assert.deepEqual(pageErrors, []);
  },
);
