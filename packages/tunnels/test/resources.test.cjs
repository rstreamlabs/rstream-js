// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const { RstreamTunnelsClient } = require("../dist/index.js");
const { createAuthTokenParamsSchema } = require("../dist/index.js");
const { createAuthTokenFromClientCredentials } = require("../dist/index.js");
const { formatTunnelHost } = require("../dist/index.js");
const { parseWebTTYServers } = require("../dist/index.js");
const { tunnelSchema } = require("../dist/index.js");

function decodePayload(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
}

test("list tunnels without params omits the params query", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (input, init) => {
    calls.push({
      authorization: init.headers.get("Authorization"),
      method: init.method,
      url: input.toString(),
    });
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  };
  try {
    const client = new RstreamTunnelsClient({
      credentials: { token: "token" },
      engine: "project-endpoint.cluster.example.rstream.test:443",
    });
    const tunnels = await client.tunnels.list();
    assert.deepEqual(tunnels, []);
    assert.deepEqual(calls, [
      {
        authorization: "Bearer token",
        method: "GET",
        url: "https://project-endpoint.cluster.example.rstream.test:443/api/tunnels",
      },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("project endpoint resolution works with application credentials", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (input, init) => {
    calls.push({
      authorization: init.headers.get("Authorization"),
      method: init.method,
      url: input.toString(),
    });
    if (
      input.toString() ===
      "https://rstream.io/api/projects/tunnels/resolve/project-endpoint"
    ) {
      return new Response(
        JSON.stringify({
          deployment: "shared",
          domain: "cluster.example.rstream.test",
          endpoint: "project-endpoint",
          enginePort: 443,
          id: "project-id",
          name: "Prod",
          plan: "pro",
          provider: "aws",
          region: "eu-west-3",
          status: "active",
          turnPort: 3478,
          turnsPort: 5349,
          url: "project-endpoint.cluster.example.rstream.test:443",
          workspaceId: "workspace-id",
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      );
    }
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  };
  try {
    const clientKeys = crypto.generateKeyPairSync("ec", {
      namedCurve: "P-521",
    });
    const client = new RstreamTunnelsClient({
      apiUrl: "https://rstream.io",
      credentials: {
        clientId: "client-id",
        clientSecret: clientKeys.privateKey
          .export({ type: "pkcs8", format: "der" })
          .toString("hex"),
      },
      projectEndpoint: "project-endpoint",
    });
    const tunnels = await client.tunnels.list();
    assert.deepEqual(tunnels, []);
    assert.equal(calls.length, 2);
    assert.equal(
      calls[0].url,
      "https://rstream.io/api/projects/tunnels/resolve/project-endpoint",
    );
    assert.equal(
      calls[1].url,
      "https://project-endpoint.cluster.example.rstream.test:443/api/tunnels",
    );
    const controlPlaneToken = calls[0].authorization.replace("Bearer ", "");
    const controlPlanePayload = decodePayload(controlPlaneToken);
    assert.equal(controlPlanePayload.type, "app");
    assert.equal(controlPlanePayload.clientId, "client-id");
    assert.equal(controlPlanePayload.metadata?.engine, undefined);
    assert.equal(controlPlanePayload.tunnelsGrants, undefined);
    const engineToken = calls[1].authorization.replace("Bearer ", "");
    const enginePayload = decodePayload(engineToken);
    assert.equal(
      enginePayload.metadata?.engine,
      "project-endpoint.cluster.example.rstream.test:443",
    );
    assert.equal(enginePayload.tunnelsGrants, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});

test("createAuthTokenFromClientCredentials normalizes global scopes to tunnelsGrants", () => {
  const clientKeys = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-521",
  });
  const { token } = createAuthTokenFromClientCredentials(
    {
      clientId: "client-id",
      clientSecret: clientKeys.privateKey
        .export({ type: "pkcs8", format: "der" })
        .toString("hex"),
    },
    {
      scopes: {
        tunnels: {
          list: true,
        },
      },
    },
  );
  const payload = decodePayload(token);
  assert.deepEqual(payload.tunnelsGrants, [
    {
      scopes: {
        tunnels: {
          list: true,
        },
      },
    },
  ]);
  assert.deepEqual(payload.metadata, {});
});

test("createAuthTokenParamsSchema rejects mixed scopes and tunnelsGrants", () => {
  const result = createAuthTokenParamsSchema.safeParse({
    tunnelsGrants: [{ projects: ["project-1"] }],
    scopes: {
      tunnels: {
        list: true,
      },
    },
  });
  assert.equal(result.success, false);
});

test("createAuthTokenParamsSchema preserves logical tunnel grant filters", () => {
  const parsed = createAuthTokenParamsSchema.parse({
    tunnelsGrants: [
      {
        projects: ["project-1"],
        scopes: {
          tunnels: {
            create: {
              filters: {
                AND: [
                  { protocol: "http" },
                  { publish: true },
                  { token_auth: true },
                ],
              },
            },
          },
        },
      },
    ],
  });
  assert.deepEqual(parsed.tunnelsGrants[0].scopes.tunnels.create.filters, {
    AND: [{ protocol: "http" }, { publish: true }, { token_auth: true }],
  });
});

test("tunnelSchema preserves stable domain properties", () => {
  const parsed = tunnelSchema.parse({
    id: "tunnel-id",
    status: "online",
    client_id: "client-id",
    type: "bytestream",
    publish: true,
    protocol: "http",
    host: "allocated.example.test:443",
    hostname: "app-project.t.cluster.example.test",
    port: 443,
    http_use_tls: true,
    upstream_tls: true,
  });
  assert.equal(parsed.host, "allocated.example.test:443");
  assert.equal(parsed.hostname, "app-project.t.cluster.example.test");
  assert.equal(parsed.port, 443);
  assert.equal(parsed.upstream_tls, true);
});

test("formatTunnelHost prefers hostname and port over deprecated host", () => {
  assert.equal(
    formatTunnelHost({
      host: "allocated.example.test:443",
      hostname: "app-project.t.cluster.example.test",
      port: 443,
    }),
    "app-project.t.cluster.example.test",
  );
  assert.equal(
    formatTunnelHost({
      host: "allocated.example.test:443",
      hostname: "app-project.t.cluster.example.test",
      port: 8443,
    }),
    "app-project.t.cluster.example.test:8443",
  );
  assert.equal(
    formatTunnelHost({ host: "allocated.example.test:443" }),
    "allocated.example.test:443",
  );
});

test("parseWebTTYServers prefers stable domain properties", () => {
  const servers = parseWebTTYServers([
    {
      id: "tunnel-id",
      status: "online",
      client_id: "client-id",
      type: "bytestream",
      publish: true,
      protocol: "http",
      labels: {
        "application-protocol": "rstream.webtty",
      },
      host: "allocated.example.test:443",
      hostname: "webtty-project.t.cluster.example.test",
      port: 443,
      token_auth: true,
    },
  ]);
  assert.equal(servers.length, 1);
  assert.equal(servers[0].host, "webtty-project.t.cluster.example.test");
});

test("createAuthTokenFromClientCredentials normalizes project tunnelsGrants", () => {
  const clientKeys = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-521",
  });
  const { token } = createAuthTokenFromClientCredentials(
    {
      clientId: "client-id",
      clientSecret: clientKeys.privateKey
        .export({ type: "pkcs8", format: "der" })
        .toString("hex"),
    },
    {
      tunnelsGrants: [
        { projects: ["project-1"] },
        {
          projects: ["project-2"],
          scopes: {
            tunnels: {
              create: true,
            },
          },
        },
      ],
    },
    { engine: "cluster.example.rstream.test:443" },
  );
  const payload = decodePayload(token);
  assert.deepEqual(payload.tunnelsGrants, [
    { projects: ["project-1"] },
    {
      projects: ["project-2"],
      scopes: {
        tunnels: {
          create: true,
        },
      },
    },
  ]);
  assert.deepEqual(payload.metadata, {
    engine: "cluster.example.rstream.test:443",
  });
});

test("list clients without params omits the params query", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (input, init) => {
    calls.push({
      authorization: init.headers.get("Authorization"),
      method: init.method,
      url: input.toString(),
    });
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  };
  try {
    const client = new RstreamTunnelsClient({
      credentials: { token: "token" },
      engine: "project-endpoint.cluster.example.rstream.test:443",
    });
    const clients = await client.clients.list();
    assert.deepEqual(clients, []);
    assert.deepEqual(calls, [
      {
        authorization: "Bearer token",
        method: "GET",
        url: "https://project-endpoint.cluster.example.rstream.test:443/api/clients",
      },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});
