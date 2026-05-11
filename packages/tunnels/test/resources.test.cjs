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
    assert.deepEqual(enginePayload.tunnelsGrants, [
      {
        projects: ["project-id"],
        scopes: {
          tunnels: {
            connect: true,
            create: true,
            list: true,
          },
        },
      },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("project endpoint resolution retries after a transient failure", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  const projectResponse = {
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
  };
  const resolveResponses = [
    new Response(JSON.stringify({ error: "temporarily unavailable" }), {
      headers: { "Content-Type": "application/json" },
      status: 503,
    }),
    new Response(JSON.stringify(projectResponse), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    }),
  ];
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
      return resolveResponses.shift();
    }
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  };
  try {
    const client = new RstreamTunnelsClient({
      apiUrl: "https://rstream.io",
      credentials: { token: "token" },
      projectEndpoint: "project-endpoint",
    });
    await assert.rejects(() => client.tunnels.list(), /503|temporarily/);
    const tunnels = await client.tunnels.list();
    assert.deepEqual(tunnels, []);
    assert.deepEqual(
      calls.map((call) => call.url),
      [
        "https://rstream.io/api/projects/tunnels/resolve/project-endpoint",
        "https://rstream.io/api/projects/tunnels/resolve/project-endpoint",
        "https://project-endpoint.cluster.example.rstream.test:443/api/tunnels",
      ],
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("createAuthTokenFromClientCredentials normalizes scoped params to project grants", () => {
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
    { projectId: "project-id" },
  );
  const payload = decodePayload(token);
  assert.deepEqual(payload.tunnelsGrants, [
    {
      projects: ["project-id"],
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
    tunnelsGrants: [
      {
        projects: ["project-1"],
        scopes: {
          tunnels: {
            list: true,
          },
        },
      },
    ],
    scopes: {
      tunnels: {
        list: true,
      },
    },
  });
  assert.equal(result.success, false);
});

test("createAuthTokenParamsSchema rejects ambiguous or unknown tunnel grant fields", () => {
  const invalid = [
    {},
    { expires_in: 60 },
    { scopes: {} },
    { scopes: { tunnels: {} } },
    { tunnelsGrants: [] },
    { tunnelsGrants: [{}] },
    {
      tunnelsGrants: [
        {
          projects: ["project-1"],
        },
      ],
    },
    {
      tunnelsGrants: [
        {
          scopes: { tunnels: { list: true } },
        },
      ],
    },
    {
      tunnelsGrants: [
        {
          projects: ["project-1"],
          scopes: { tunnels: { list: true } },
          workspaces: ["workspace-1"],
        },
      ],
    },
    {
      tunnelsGrants: [
        {
          projects: [],
          scopes: { tunnels: { list: true } },
        },
      ],
    },
    {
      tunnelsGrants: [
        {
          projects: ["project-1"],
          scopes: { streams: { list: true } },
        },
      ],
    },
    {
      tunnelsGrants: [
        {
          projects: ["project-1"],
          scopes: { tunnels: { delete: true } },
        },
      ],
    },
    {
      tunnelsGrants: [
        {
          projects: ["project-1"],
          scopes: { tunnels: { create: { extra: true } } },
        },
      ],
    },
    {
      tunnelsGrants: [
        {
          projects: ["project-1"],
          scopes: { tunnels: { create: { filters: { workspace_id: "ws" } } } },
        },
      ],
    },
    {
      tunnelsGrants: [
        {
          projects: ["project-1"],
          scopes: {
            tunnels: {
              list: {
                select: { not_a_tunnel_field: true },
              },
            },
          },
        },
      ],
    },
    {
      tunnelsGrants: [
        {
          projects: ["project-1"],
          scopes: {
            tunnels: {
              connect: {
                filters: { name: { exact: "api", regex: "^api$" } },
              },
            },
          },
        },
      ],
    },
  ];
  for (const payload of invalid) {
    assert.equal(createAuthTokenParamsSchema.safeParse(payload).success, false);
  }
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

test("createAuthTokenParamsSchema preserves connect params and list selection scopes", () => {
  const parsed = createAuthTokenParamsSchema.parse({
    tunnelsGrants: [
      {
        workspaces: ["workspace-1"],
        scopes: {
          tunnels: {
            connect: {
              filters: { labels: { env: { exact: "prod" } } },
              params: { path: { regex: "^/admin(?:/|$)" } },
            },
            list: {
              filters: {
                OR: [{ protocol: "http" }, { protocol: "tls" }],
              },
              select: { host: true, id: true, name: true },
            },
          },
        },
      },
    ],
  });
  assert.deepEqual(parsed.tunnelsGrants[0].scopes.tunnels.connect.params, {
    path: { regex: "^/admin(?:/|$)" },
  });
  assert.deepEqual(parsed.tunnelsGrants[0].scopes.tunnels.list.select, {
    host: true,
    id: true,
    name: true,
  });
});

test("createAuthTokenParamsSchema enforces short auth-token lifetimes", () => {
  const scopes = {
    tunnels: {
      list: true,
    },
  };
  assert.equal(
    createAuthTokenParamsSchema.parse({ expires_in: 3600, scopes }).expires_in,
    3600,
  );
  for (const expires_in of [0, -1, 1.5, 3601]) {
    assert.equal(
      createAuthTokenParamsSchema.safeParse({ expires_in, scopes }).success,
      false,
    );
  }
});

test("createAuthTokenFromClientCredentials signs bounded fine-grained grants", () => {
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
      expires_in: 300,
      tunnelsGrants: [
        {
          workspaces: ["workspace-1"],
          scopes: {
            tunnels: {
              connect: {
                params: { path: { regex: "^/tenant-a/" } },
              },
            },
          },
        },
      ],
    },
  );
  const payload = decodePayload(token);
  assert.equal(payload.exp - payload.iat, 300);
  assert.deepEqual(payload.tunnelsGrants, [
    {
      workspaces: ["workspace-1"],
      scopes: {
        tunnels: {
          connect: {
            params: { path: { regex: "^/tenant-a/" } },
          },
        },
      },
    },
  ]);
});

test("createAuthTokenFromClientCredentials rejects implicit broad grants", () => {
  const clientKeys = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-521",
  });
  const credentials = {
    clientId: "client-id",
    clientSecret: clientKeys.privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("hex"),
  };
  assert.throws(
    () => createAuthTokenFromClientCredentials(credentials),
    /Explicit scopes or tunnelsGrants are required|Invalid input/,
  );
  assert.throws(
    () => createAuthTokenFromClientCredentials(credentials, { expires_in: 60 }),
    /Explicit scopes or tunnelsGrants are required/,
  );
  assert.throws(
    () =>
      createAuthTokenFromClientCredentials(credentials, {
        scopes: { tunnels: { list: true } },
      }),
    /Project ID or workspace ID is required/,
  );
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
        {
          projects: ["project-1"],
          scopes: {
            tunnels: {
              list: true,
            },
          },
        },
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
    {
      projects: ["project-1"],
      scopes: {
        tunnels: {
          list: true,
        },
      },
    },
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

test("resource get requests encode path identifiers", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (input, init) => {
    calls.push({
      authorization: init.headers.get("Authorization"),
      method: init.method,
      url: input.toString(),
    });
    if (input.toString().includes("/api/clients/")) {
      return new Response(
        JSON.stringify({
          id: "client/tenant",
          status: "online",
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      );
    }
    return new Response(
      JSON.stringify({
        client_id: "client-id",
        id: "tunnel/tenant",
        status: "online",
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200,
      },
    );
  };
  try {
    const client = new RstreamTunnelsClient({
      credentials: { token: "token" },
      engine: "project-endpoint.cluster.example.rstream.test:443",
    });
    const tunnel = await client.tunnels.get(" tunnel/tenant?view=admin ");
    const connectedClient = await client.clients.get(" client/tenant?x=1 ");
    assert.equal(tunnel.id, "tunnel/tenant");
    assert.equal(connectedClient.id, "client/tenant");
    assert.deepEqual(calls, [
      {
        authorization: "Bearer token",
        method: "GET",
        url: "https://project-endpoint.cluster.example.rstream.test:443/api/tunnels/tunnel%2Ftenant%3Fview%3Dadmin",
      },
      {
        authorization: "Bearer token",
        method: "GET",
        url: "https://project-endpoint.cluster.example.rstream.test:443/api/clients/client%2Ftenant%3Fx%3D1",
      },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("resource get requests reject blank identifiers before IO", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (input) => {
    calls.push(input.toString());
    return new Response(JSON.stringify({}), { status: 200 });
  };
  try {
    const client = new RstreamTunnelsClient({
      credentials: { token: "token" },
      engine: "project-endpoint.cluster.example.rstream.test:443",
    });
    await assert.rejects(
      () => client.tunnels.get(" "),
      /Tunnel ID is required/,
    );
    await assert.rejects(
      () => client.clients.get(" "),
      /Client ID is required/,
    );
    assert.deepEqual(calls, []);
  } finally {
    global.fetch = originalFetch;
  }
});
