// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const { createAuthTokenFromClientCredentials } = require("../dist/index.js");
const { createAuthTokenParamsSchema } = require("@rstreamlabs/rstream/auth-token");
const { formatTunnelHost } = require("../dist/index.js");
const { parseWebTTYServers } = require("../dist/index.js");
const { RstreamTunnelsClient } = require("../dist/index.js");
const { tunnelSchema } = require("@rstreamlabs/rstream/tunnel");

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
    assert.equal(controlPlanePayload.resources, undefined);
    const engineToken = calls[1].authorization.replace("Bearer ", "");
    const enginePayload = decodePayload(engineToken);
    assert.equal(
      enginePayload.metadata?.engine,
      "project-endpoint.cluster.example.rstream.test:443",
    );
    assert.deepEqual(enginePayload.resources, {
      tunnels: {
        projects: ["project-id"],
        scopes: {
          tunnels: {
            connect: true,
            create: true,
            list: true,
          },
        },
      },
    });
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

test("auth resource scopes tunnel resources to the resolved project endpoint", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
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
          plan: "basic",
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
    const { token } = await client.auth.createAuthToken({
      resources: {
        tunnels: {
          scopes: {
            tunnels: {
              connect: true,
            },
          },
        },
      },
    });
    const payload = decodePayload(token);
    assert.deepEqual(payload.resources, {
      tunnels: {
        projects: ["project-id"],
        scopes: {
          tunnels: {
            connect: true,
          },
        },
      },
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("createAuthTokenFromClientCredentials normalizes scoped params to project resources", () => {
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
      resources: {
        tunnels: {
          scopes: {
            tunnels: {
              list: true,
            },
          },
        },
      },
    },
    { projectId: "project-id" },
  );
  const payload = decodePayload(token);
  assert.deepEqual(payload.resources, {
    tunnels: {
      projects: ["project-id"],
      scopes: {
        tunnels: {
          list: true,
        },
      },
    },
  });
  assert.deepEqual(payload.metadata, {});
});

test("createAuthTokenFromClientCredentials scopes resource leaves with implicit targets", () => {
  const clientKeys = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-521",
  });
  const credentials = {
    clientId: "client-id",
    clientSecret: clientKeys.privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("hex"),
  };
  const { token } = createAuthTokenFromClientCredentials(
    credentials,
    {
      resources: {
        tunnels: {
          OR: [
            {
              scopes: {
                tunnels: {
                  connect: true,
                },
              },
            },
            {
              projects: ["explicit-project"],
              scopes: {
                tunnels: {
                  list: true,
                },
              },
            },
          ],
        },
      },
    },
    { projectId: "default-project" },
  );
  const payload = decodePayload(token);
  assert.deepEqual(payload.resources, {
    tunnels: {
      OR: [
        {
          projects: ["default-project"],
          scopes: {
            tunnels: {
              connect: true,
            },
          },
        },
        {
          projects: ["explicit-project"],
          scopes: {
            tunnels: {
              list: true,
            },
          },
        },
      ],
    },
  });
});

test("createAuthTokenFromClientCredentials can opt out of default project scoping", () => {
  const clientKeys = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-521",
  });
  const credentials = {
    clientId: "client-id",
    clientSecret: clientKeys.privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("hex"),
  };
  const { token } = createAuthTokenFromClientCredentials(
    credentials,
    {
      resources: {
        tunnels: {
          scopes: {
            tunnels: {
              list: true,
            },
          },
        },
      },
    },
    { projectScoped: false },
  );
  const payload = decodePayload(token);
  assert.deepEqual(payload.resources, {
    tunnels: {
      scopes: {
        tunnels: {
          list: true,
        },
      },
    },
  });
});

test("createAuthTokenFromClientCredentials accepts explicit AND target branches", () => {
  const clientKeys = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-521",
  });
  const credentials = {
    clientId: "client-id",
    clientSecret: clientKeys.privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("hex"),
  };
  const { token } = createAuthTokenFromClientCredentials(credentials, {
    resources: {
      tunnels: {
        AND: [
          { projects: ["project-id"] },
          {
            scopes: {
              tunnels: {
                connect: true,
              },
            },
          },
        ],
      },
    },
  });
  const payload = decodePayload(token);
  assert.deepEqual(payload.resources, {
    tunnels: {
      AND: [
        { projects: ["project-id"] },
        {
          scopes: {
            tunnels: {
              connect: true,
            },
          },
        },
      ],
    },
  });
});

test("createAuthTokenParamsSchema rejects legacy scope and resource params", () => {
  const result = createAuthTokenParamsSchema.safeParse({
    tunnelsGrants: {
      projects: ["project-1"],
      scopes: {
        tunnels: {
          list: true,
        },
      },
    },
    scopes: {
      tunnels: {
        list: true,
      },
    },
  });
  assert.equal(result.success, false);
});

test("createAuthTokenParamsSchema rejects ambiguous or unknown tunnel resource fields", () => {
  const invalid = [
    {},
    { expires_in: 60 },
    { scopes: {} },
    { scopes: { tunnels: {} } },
    { tunnelsGrants: [] },
    { tunnelsGrants: {} },
    { resources: [] },
    { resources: {} },
    {
      resources: {
        tunnels: {
          projects: ["project-1"],
          scopes: { tunnels: { list: true } },
          workspaces: ["workspace-1"],
        },
      },
    },
    {
      resources: {
        tunnels: {
          projects: [],
          scopes: { tunnels: { list: true } },
        },
      },
    },
    {
      resources: {
        tunnels: {
          projects: ["project-1"],
          scopes: { streams: { list: true } },
        },
      },
    },
    {
      resources: {
        tunnels: {
          projects: ["project-1"],
          scopes: { tunnels: { delete: true } },
        },
      },
    },
    {
      resources: {
        tunnels: {
          projects: ["project-1"],
          scopes: { tunnels: { create: { extra: true } } },
        },
      },
    },
    {
      resources: {
        tunnels: {
          projects: ["project-1"],
          scopes: { tunnels: { create: { filters: { workspace_id: "ws" } } } },
        },
      },
    },
    {
      resources: {
        tunnels: {
          projects: ["project-1"],
          scopes: {
            tunnels: {
              list: {
                select: { not_a_tunnel_field: true },
              },
            },
          },
        },
      },
    },
    {
      resources: {
        tunnels: {
          projects: ["project-1"],
          scopes: {
            tunnels: {
              connect: {
                filters: { name: { exact: "api", regex: "^api$" } },
              },
            },
          },
        },
      },
    },
  ];
  for (const payload of invalid) {
    assert.equal(createAuthTokenParamsSchema.safeParse(payload).success, false);
  }
});

test("createAuthTokenParamsSchema preserves logical tunnel resource filters", () => {
  const parsed = createAuthTokenParamsSchema.parse({
    resources: {
      tunnels: {
        AND: [
          { projects: ["project-1"] },
          {
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
      },
    },
  });
  assert.deepEqual(
    parsed.resources.tunnels.AND[1].scopes.tunnels.create.filters,
    {
      AND: [{ protocol: "http" }, { publish: true }, { token_auth: true }],
    },
  );
});

test("createAuthTokenParamsSchema preserves connect params and list selection scopes", () => {
  const parsed = createAuthTokenParamsSchema.parse({
    resources: {
      tunnels: {
        OR: [
          {
            workspaces: ["workspace-1"],
            scopes: {
              tunnels: {
                connect: {
                  filters: { labels: { env: { exact: "prod" } } },
                  params: { path: { regex: "^/admin(?:/|$)" } },
                },
              },
            },
          },
          {
            projects: ["project-1"],
            scopes: {
              tunnels: {
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
      },
    },
  });
  assert.deepEqual(
    parsed.resources.tunnels.OR[0].scopes.tunnels.connect.params,
    {
      path: { regex: "^/admin(?:/|$)" },
    },
  );
  assert.deepEqual(
    parsed.resources.tunnels.OR[1].scopes.tunnels.list.select,
    {
      host: true,
      id: true,
      name: true,
    },
  );
});

test("createAuthTokenParamsSchema enforces short auth-token lifetimes", () => {
  const resources = {
    tunnels: {
      scopes: {
        tunnels: {
          list: true,
        },
      },
    },
  };
  assert.equal(
    createAuthTokenParamsSchema.parse({ expires_in: 3600, resources })
      .expires_in,
    3600,
  );
  for (const expires_in of [0, -1, 1.5, 3601]) {
    assert.equal(
      createAuthTokenParamsSchema.safeParse({ expires_in, resources }).success,
      false,
    );
  }
});

test("createAuthTokenFromClientCredentials signs bounded fine-grained resources", () => {
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
      resources: {
        tunnels: {
          workspaces: ["workspace-1"],
          scopes: {
            tunnels: {
              connect: {
                params: { path: { regex: "^/tenant-a/" } },
              },
            },
          },
        },
      },
    },
  );
  const payload = decodePayload(token);
  assert.equal(payload.exp - payload.iat, 300);
  assert.deepEqual(payload.resources, {
    tunnels: {
      workspaces: ["workspace-1"],
      scopes: {
        tunnels: {
          connect: {
            params: { path: { regex: "^/tenant-a/" } },
          },
        },
      },
    },
  });
});

test("createAuthTokenFromClientCredentials rejects implicit broad resources", () => {
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
    /Explicit resources\.tunnels is required|Invalid input/,
  );
  assert.throws(
    () => createAuthTokenFromClientCredentials(credentials, { expires_in: 60 }),
    /Explicit resources\.tunnels is required/,
  );
  assert.throws(
    () =>
      createAuthTokenFromClientCredentials(credentials, {
        scopes: { tunnels: { list: true } },
      }),
    /Unrecognized key|Explicit resources\.tunnels/,
  );
  assert.throws(
    () =>
      createAuthTokenFromClientCredentials(credentials, {
        resources: {
          tunnels: {
            scopes: { tunnels: { list: true } },
          },
        },
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

test("createAuthTokenFromClientCredentials normalizes project resources", () => {
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
      resources: {
        tunnels: {
          OR: [
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
      },
    },
    { engine: "cluster.example.rstream.test:443" },
  );
  const payload = decodePayload(token);
  assert.deepEqual(payload.resources, {
    tunnels: {
      OR: [
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
  });
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
