// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const test = require("node:test");

const engineOpenApiDocument = require("../dist/openapi.js").engineOpenApiDocument;

test("engineOpenApiDocument exposes the engine automation contract", () => {
  assert.equal(engineOpenApiDocument.openapi, "3.1.0");
  assert.ok(engineOpenApiDocument.paths["/api/clients"]);
  assert.ok(engineOpenApiDocument.paths["/api/tunnels"]);
  assert.ok(engineOpenApiDocument.paths["/api/sse"]);
  assert.ok(engineOpenApiDocument.paths["/api/websocket"]);
  assert.ok(engineOpenApiDocument["x-rstream-permissions"]);
  assert.ok(engineOpenApiDocument["x-rstream-use-case-permissions"]);
});

test("engine OpenAPI WebTTY use cases separate tunnel and managed workflows", () => {
  const permissions = engineOpenApiDocument["x-rstream-permissions"];
  const useCases = engineOpenApiDocument["x-rstream-use-case-permissions"];
  const tunnelWebTTY = useCases["run-tunnel-webtty"];
  assert.ok(permissions["webtty.sessions.read-only"]);
  assert.ok(permissions["webtty.sessions.read-write"]);
  assert.ok(permissions["webtty.logs.read-only"]);
  assert.equal(
    permissions["webtty.sessions.read-only"].description,
    "List managed WebTTY sessions, participants, replay state, and join as a spectator.",
  );
  assert.equal(
    permissions["webtty.sessions.read-write"].description,
    "Create managed WebTTY sessions and coordinate control requests for active sessions.",
  );
  assert.equal(
    permissions["webtty.logs.read-only"].name,
    "WebTTY Session Logs: Read-Only",
  );
  assert.equal(
    permissions["webtty.logs.read-only"].description,
    "Read managed WebTTY session logs. End-to-end encrypted content still requires trusted local key material.",
  );
  assert.deepEqual(
    permissions["webtty.logs.read-only"].rules.map((rule) => rule.resource),
    ["engine.webtty.sessions", "engine.webtty.logs"],
  );
  assert.equal(useCases["operate-webtty"], undefined);
  assert.equal(permissions["webtty.sessions.attach"], undefined);
  assert.equal(permissions["webtty.sessions.control"], undefined);
  assert.equal(permissions["webtty.sessions.terminate"], undefined);
  assert.equal(permissions["webtty.logs.decrypt"], undefined);
  assert.equal(permissions["webtty.logs.payload_read"], undefined);
  for (const [id, permission] of Object.entries(permissions)) {
    if (!id.startsWith("webtty.")) continue;
    for (const rule of permission.rules ?? []) {
      const actions = Array.isArray(rule.action) ? rule.action : [rule.action];
      assert.equal(
        actions.some((action) =>
          /(?:attach|control|terminate|decrypt|payload)/.test(action),
        ),
        false,
      );
    }
  }
  assert.ok(tunnelWebTTY.includes("tunnels.resources.read-only"));
  assert.ok(tunnelWebTTY.includes("tunnels.tunnels.create-delete"));
  assert.ok(tunnelWebTTY.includes("tunnels.streams.create-delete"));
  assert.equal(tunnelWebTTY.includes("webtty.sessions.read-write"), false);
  assert.equal(tunnelWebTTY.includes("webtty.logs.read-only"), false);
  assert.deepEqual(useCases["join-managed-webtty"], [
    "webtty.sessions.read-only",
  ]);
  assert.deepEqual(useCases["control-managed-webtty"], [
    "webtty.sessions.read-write",
  ]);
  assert.deepEqual(useCases["read-managed-webtty-recordings"], [
    "webtty.logs.read-only",
  ]);
});

test("engine operations expose backend rules for scope selection", () => {
  for (const path of [
    "/api/clients",
    "/api/tunnels",
    "/api/sse",
    "/api/websocket",
  ]) {
    const operation = engineOpenApiDocument.paths[path].get;
    assert.ok(operation["x-rstream-required-rules"]);
  }
});

test("engine OpenAPI does not advertise query-string bearer tokens", () => {
  assert.equal(
    engineOpenApiDocument.components.securitySchemes.queryToken,
    undefined,
  );
  for (const path of [
    "/api/clients",
    "/api/tunnels",
    "/api/sse",
    "/api/websocket",
  ]) {
    const operation = engineOpenApiDocument.paths[path].get;
    assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
  }
});

test("engine list and watch operations document JSON params", () => {
  for (const path of [
    "/api/clients",
    "/api/tunnels",
    "/api/sse",
    "/api/websocket",
  ]) {
    const operation = engineOpenApiDocument.paths[path].get;
    const params = operation.parameters ?? [];
    const queryParams = params.map((param) => {
      if (param.$ref) {
        const name = param.$ref.split("/").at(-1);
        return engineOpenApiDocument.components.parameters[name];
      }
      return param;
    });
    assert.ok(queryParams.some((param) => param.name === "params"));
  }
  assert.ok(engineOpenApiDocument.components.schemas.WatchParams);
});
