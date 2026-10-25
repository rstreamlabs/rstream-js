// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const path = require("node:path");
const test = require("node:test");
const { build } = require("esbuild");
const { chromium } = require("playwright-core");

test("React inventory handles restrictions, partial objects and authentication changes", async (t) => {
  const bundle = await build({
    stdin: {
      resolveDir: path.join(__dirname, ".."), loader: "tsx",
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { useRstream } from "./src/hooks/use-rstream";
        function Inventory({ options }) {
          const state = useRstream(options);
          return <pre id="state">{JSON.stringify(state)}</pre>;
        }
        const root = createRoot(document.getElementById("root"));
        window.renderInventory = (auth) => root.render(<Inventory options={auth ? { auth, engine: "engine.example", reconnectTimeout: 10 } : undefined} />);
        window.renderInventory("first");
      `,
    },
    bundle: true, write: false, format: "iife", platform: "browser",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "watch-boundary", setup(builder) {
      builder.onResolve({ filter: /^@rstreamlabs\/tunnels$/ }, () => ({ path: "watch", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `
        window.watches = [];
        export class Watch {
          constructor(config, events) { this.config = config; this.events = events; this.closes = 0; window.watches.push(this); }
          async connect() { this.events.onConnect(); }
          disconnect() { this.closes++; this.events.onClose(); }
        }
      ` }));
    } }],
  });
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.watches?.length === 1);
  const snapshot = async (clients, tunnels) => {
    await page.evaluate(({ clients, tunnels }) => window.watches.at(-1).events.onEvent({ type: "state.initial", object: { clients, tunnels } }), { clients, tunnels });
    await page.waitForFunction(({ clients, tunnels }) => {
      const state = JSON.parse(document.getElementById("state").textContent);
      return JSON.stringify(state.clients) === JSON.stringify(clients) && JSON.stringify(state.tunnels) === JSON.stringify(tunnels);
    }, { clients, tunnels });
  };
  await snapshot([], [{ id: "terminal", protocol: "webtty" }]);
  await snapshot([{ id: "agent", labels: { env: "prod" } }], []);
  await snapshot([], [{ labels: { env: "prod" } }, {}]);
  await snapshot([], [{ labels: { env: "stage" } }]);
  for (const kind of ["client", "tunnel"]) {
    await snapshot([], []);
    await page.evaluate((kind) => {
      const events = window.watches.at(-1).events;
      events.onEvent({ type: kind + ".updated", object: { id: "newly-visible" } });
      events.onEvent({ type: kind + ".created", object: { id: "newly-visible", labels: { env: "prod" } } });
    }, kind);
    await page.waitForFunction((category) => {
      const items = JSON.parse(document.getElementById("state").textContent)[category];
      return items.length === 1 && items[0].labels?.env === "prod";
    }, kind + "s");
    await page.evaluate((kind) => window.watches.at(-1).events.onEvent({ type: kind + ".deleted", object: { id: "newly-visible" } }), kind);
    await page.waitForFunction((category) => JSON.parse(document.getElementById("state").textContent)[category].length === 0, kind + "s");
  }
  await snapshot([{ id: "old-agent" }], [{ id: "old-tunnel" }]);
  await page.evaluate(() => window.renderInventory("second"));
  await page.waitForFunction(() => window.watches.length === 2);
  await page.waitForFunction(() => {
    const state = JSON.parse(document.getElementById("state").textContent);
    return state.clients.length === 0 && state.tunnels.length === 0;
  });
  await page.evaluate(() => window.watches[0].events.onEvent({ type: "state.initial", object: { clients: [{ id: "stale" }], tunnels: [] } }));
  await snapshot([], [{ id: "current-tunnel" }]);
  await page.evaluate(() => window.renderInventory(undefined));
  await page.waitForFunction(() => {
    const state = JSON.parse(document.getElementById("state").textContent);
    return state.clients.length === 0 && state.tunnels.length === 0;
  });
  assert.deepEqual(await page.evaluate(() => window.watches.map((watch) => watch.closes)), [1, 1]);
  assert.deepEqual(errors, []);
});
