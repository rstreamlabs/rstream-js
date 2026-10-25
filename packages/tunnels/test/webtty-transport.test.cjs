// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const test = require("node:test");
const parseWebTTYServers = require("../dist/index.js").parseWebTTYServers;
const resolveWebTTYServerTransport = require("../dist/index.js").resolveWebTTYServerTransport;
const resolveWebTTYBrowserEndpoint = require("../dist/index.js").resolveWebTTYBrowserEndpoint;

for (const transport of ["plain", "websocket", "webtransport"]) {
  for (const managed of [false, true]) {
    for (const publish of [false, true]) {
      test(`WebTTY discovery ${transport}, managed=${managed}, published=${publish}`, () => {
        const [server] = parseWebTTYServers([{
          id: "shell", status: "online", publish,
          protocol: managed ? "webtty" : publish ? "http" : undefined,
          type: transport === "webtransport" ? "datagram" : "bytestream",
          hostname: publish ? "shell.example.test" : undefined,
          labels: { "application-protocol": "rstream.webtty", "rstream.webtty.transport": transport, "rstream.webtty.exec.path": "/terminal" },
        }], { includePrivate: true });
        assert.ok(server);
        assert.equal(server.transport, transport);
        assert.equal(resolveWebTTYServerTransport(server), transport);
        for (const requested of ["plain", "websocket", "webtransport"]) {
          if (requested === transport) assert.equal(resolveWebTTYServerTransport(server, requested), transport);
          else assert.throws(() => resolveWebTTYServerTransport(server, requested), /conflicts/);
        }
        if (!publish || transport === "plain") assert.throws(() => resolveWebTTYBrowserEndpoint(server), /native client/);
        else assert.deepEqual(resolveWebTTYBrowserEndpoint(server), {
          url: `${transport === "webtransport" ? "https" : "wss"}://shell.example.test/terminal`, transport,
        });
      });
    }
  }
}

test("legacy inventory supports inference and explicit ambiguous transport", () => {
  assert.equal(resolveWebTTYServerTransport({}), "websocket");
  assert.equal(resolveWebTTYServerTransport({}, "plain"), "plain");
  assert.equal(resolveWebTTYServerTransport({ tunnel_type: "datagram" }), "webtransport");
  assert.throws(() => resolveWebTTYServerTransport({ tunnel_type: "datagram" }, "websocket"), /conflicts/);
  assert.throws(() => resolveWebTTYServerTransport({ tunnel_type: "bytestream", transport: "webtransport" }), /conflicts/);
  assert.throws(() => resolveWebTTYServerTransport({ tunnel_type: "datagram", http_version: "http/1.1" }), /HTTP\/3/);
});

test("WebTTY discovery accepts projected inventory without inventing missing fields", () => {
  const minimal = { id: "terminal", status: "online", protocol: "webtty" };
  assert.deepEqual(parseWebTTYServers([{}, { labels: { env: "prod" } }], { includePrivate: true }), []);
  assert.deepEqual(parseWebTTYServers([minimal]), []);
  const [privateServer] = parseWebTTYServers([minimal], { includePrivate: true });
  assert.equal(privateServer.tunnel_id, "terminal");
  assert.equal(privateServer.host, "");
  assert.equal(privateServer.workspace_id, undefined);
  assert.equal(privateServer.project_id, undefined);
  assert.equal(privateServer.tunnel_type, undefined);
  assert.throws(() => resolveWebTTYBrowserEndpoint(privateServer), /native client/);
  const [publishedServer] = parseWebTTYServers([{ ...minimal, publish: true, hostname: "terminal.example.test" }]);
  assert.deepEqual(resolveWebTTYBrowserEndpoint(publishedServer), { url: "wss://terminal.example.test/", transport: "websocket" });
  for (const field of ["id", "status", "protocol"]) {
    const projected = Object.fromEntries(Object.entries(minimal).filter(([key]) => key !== field));
    assert.deepEqual(parseWebTTYServers([projected], { includePrivate: true }), []);
  }
});

for (const value of ["future", ""]) {
  test(`invalid transport ${JSON.stringify(value)} remains visible and fails explicitly`, () => {
    const [server] = parseWebTTYServers([{ id: "shell", status: "online", publish: true, protocol: "http", host: "shell.example.test", labels: { "application-protocol": "rstream.webtty", "rstream.webtty.transport": value } }]);
    assert.ok(server);
    assert.throws(() => resolveWebTTYBrowserEndpoint(server), /invalid WebTTY transport/);
    assert.throws(() => resolveWebTTYServerTransport(server, "websocket"), /invalid WebTTY transport/);
  });
}
