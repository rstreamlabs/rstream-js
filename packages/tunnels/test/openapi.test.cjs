// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const test = require("node:test");

const { engineOpenApiDocument } = require("../dist/openapi.js");

test("engineOpenApiDocument exposes the engine automation contract", () => {
  assert.equal(engineOpenApiDocument.openapi, "3.1.0");
  assert.ok(engineOpenApiDocument.paths["/api/clients"]);
  assert.ok(engineOpenApiDocument.paths["/api/tunnels"]);
  assert.ok(engineOpenApiDocument.paths["/api/sse"]);
  assert.ok(engineOpenApiDocument.paths["/api/websocket"]);
  assert.ok(engineOpenApiDocument["x-rstream-permissions"]);
  assert.ok(engineOpenApiDocument["x-rstream-use-case-permissions"]);
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
