import assert from "node:assert/strict";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import protobuf from "protobufjs";
import { WebSocketServer } from "ws";

const directory = path.dirname(fileURLToPath(import.meta.url));

test(
  "connected terminal never copies its authorized URL into the visible log",
  { timeout: 30000 },
  async (t) => {
    const Message = protobuf
      .loadSync(
        path.join(directory, "../../../packages/webtty/protobuf/webtty.proto"),
      )
      .lookupType("rstream.webtty.protobuf.Message");
    const result = await build({
      stdin: {
        resolveDir: path.join(directory, ".."),
        loader: "tsx",
        contents:
          'import React from "react"; import { createRoot } from "react-dom/client"; import Page from "./src/app/webtty/page"; createRoot(document.getElementById("root")).render(<Page />);',
      },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      loader: { ".css": "empty" },
      define: { "process.env.NODE_ENV": '"development"' },
    });
    const server = createServer((_req, response) =>
      response.end(
        `<div id="root"></div><script>${result.outputFiles[0].text}</script>`,
      ),
    );
    const sockets = new WebSocketServer({ server });
    sockets.on("connection", (socket) =>
      socket.on("message", (bytes) => {
        if (Message.decode(bytes).open)
          socket.send(Message.encode(Message.create({ ack: {} })).finish());
      }),
    );
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
    const origin = `http://127.0.0.1:${server.address().port}`;
    const credential = "synthetic-grant-private-value";
    await page.goto(origin);
    await page
      .getByRole("textbox")
      .fill(origin.replace("http:", "ws:") + "/?rstream.token=" + credential);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByText(/Connected/).waitFor();
    assert.doesNotMatch(
      (await page.locator("pre").allTextContents()).join("\n"),
      new RegExp(credential),
    );
  },
);
