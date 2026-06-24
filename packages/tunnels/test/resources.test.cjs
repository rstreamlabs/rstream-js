// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const test = require("node:test");

const authToken = require("@rstreamlabs/rstream/auth-token");
const createAuthTokenFromClientCredentials = require("../dist/index.js").createAuthTokenFromClientCredentials;
const crypto = require("node:crypto");
const formatTunnelHost = require("../dist/index.js").formatTunnelHost;
const parseWebTTYServers = require("../dist/index.js").parseWebTTYServers;
const RstreamTunnelsClient = require("../dist/index.js").RstreamTunnelsClient;
const tunnelSchema = require("@rstreamlabs/rstream/tunnel").tunnelSchema;
const webTTYKeyGrantSchema = require("../dist/index.js").webTTYKeyGrantSchema;
const webTTYSessionEventSchema = require("../dist/index.js").webTTYSessionEventSchema;

const createAuthTokenParamsSchema = authToken.createAuthTokenParamsSchema;

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
  assert.deepEqual(parsed.resources.tunnels.OR[1].scopes.tunnels.list.select, {
    host: true,
    id: true,
    name: true,
  });
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

test("tunnelSchema accepts managed WebTTY protocol", () => {
  const parsed = tunnelSchema.parse({
    id: "tunnel-id",
    status: "online",
    client_id: "client-id",
    type: "bytestream",
    publish: true,
    protocol: "webtty",
    hostname: "webtty-project.t.cluster.example.test",
    port: 443,
  });
  assert.equal(parsed.protocol, "webtty");
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
        "rstream.webtty.capabilities": "exec,fs",
        "rstream.webtty.exec.path": "/",
        "rstream.webtty.fs.path": "/fs",
        "rstream.webtty.fs.mode": "read-write",
      },
      host: "allocated.example.test:443",
      hostname: "webtty-project.t.cluster.example.test",
      port: 443,
      token_auth: true,
    },
  ]);
  assert.equal(servers.length, 1);
  assert.equal(servers[0].managed, false);
  assert.equal(servers[0].tunnel_protocol, "http");
  assert.equal(servers[0].host, "webtty-project.t.cluster.example.test");
  assert.deepEqual(servers[0].capabilities, ["exec", "fs"]);
  assert.equal(servers[0].exec_path, "/");
  assert.equal(servers[0].fs_path, "/fs");
  assert.equal(servers[0].fs_mode, "read-write");
});

test("parseWebTTYServers defaults legacy capability labels to exec", () => {
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
  assert.deepEqual(servers[0].capabilities, ["exec"]);
  assert.equal(servers[0].exec_path, "/");
  assert.equal(servers[0].fs_path, undefined);
  assert.equal(servers[0].fs_mode, undefined);
});

test("parseWebTTYServers normalizes capability labels", () => {
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
        "rstream.webtty.capabilities": "fs,unknown,exec,fs",
      },
      host: "allocated.example.test:443",
      hostname: "webtty-project.t.cluster.example.test",
      port: 443,
      token_auth: true,
    },
  ]);
  assert.deepEqual(servers[0].capabilities, ["exec", "fs"]);
  assert.equal(servers[0].exec_path, "/");
  assert.equal(servers[0].fs_path, "/fs");
  assert.equal(servers[0].fs_mode, "read-write");
});

test("parseWebTTYServers discovers managed WebTTY tunnels without legacy labels", () => {
  const servers = parseWebTTYServers([
    {
      id: "tunnel-id",
      status: "online",
      client_id: "client-id",
      type: "bytestream",
      publish: true,
      protocol: "webtty",
      labels: {
        "rstream.webtty.server_id": "server-1",
        "rstream.webtty.server_name": "prod-shell",
        "rstream.webtty.host_key_id": "sha256:host-key",
        "rstream.webtty.e2e": "required",
        "rstream.webtty.client_proof": "required",
        "rstream.webtty.encryption_policy": "explicit_key",
      },
      host: "allocated.example.test:443",
      hostname: "webtty-project.t.cluster.example.test",
      port: 443,
      token_auth: true,
    },
  ]);
  assert.equal(servers.length, 1);
  assert.equal(servers[0].managed, true);
  assert.equal(servers[0].tunnel_protocol, "webtty");
  assert.equal(servers[0].server_id, "server-1");
  assert.equal(servers[0].server_name, "prod-shell");
  assert.equal(servers[0].host_key_id, "sha256:host-key");
  assert.equal(servers[0].e2e, "required");
  assert.equal(servers[0].client_proof, "required");
  assert.equal(servers[0].encryption_policy, "explicit_key");
  assert.equal(servers[0].host, "webtty-project.t.cluster.example.test");
  assert.deepEqual(servers[0].capabilities, ["exec"]);
  assert.equal(servers[0].exec_path, "/");
});

test("parseWebTTYServers preserves explicit disabled E2E policy labels", () => {
  const servers = parseWebTTYServers([
    {
      id: "tunnel-id",
      status: "online",
      client_id: "client-id",
      type: "bytestream",
      publish: true,
      protocol: "webtty",
      labels: {
        "rstream.webtty.server_id": "server-1",
        "rstream.webtty.e2e": "disabled",
        "rstream.webtty.client_proof": "none",
        "rstream.webtty.encryption_policy": "disabled",
      },
      host: "allocated.example.test:443",
      hostname: "webtty-project.t.cluster.example.test",
      port: 443,
      token_auth: true,
    },
  ]);
  assert.equal(servers.length, 1);
  assert.equal(servers[0].e2e, "disabled");
  assert.equal(servers[0].client_proof, "none");
  assert.equal(servers[0].encryption_policy, "disabled");
});

test("webtty resource lists sessions with encoded params", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (input, init) => {
    calls.push({
      authorization: init.headers.get("Authorization"),
      method: init.method,
      url: input.toString(),
    });
    const url = new URL(input.toString());
    assert.equal(url.pathname, "/api/webtty/sessions");
    assert.deepEqual(JSON.parse(url.searchParams.get("params")), {
      filters: { server_id: "server-1", status: "active" },
      limit: 10,
    });
    return new Response(
      JSON.stringify([
        {
          id: "session-1",
          tunnel_id: "tunnel-1",
          status: "active",
          session_mode: "interactive",
          recording_mode: "recorded",
          encryption_mode: "e2e",
          started_at: "2026-06-06T12:00:00Z",
          live: {
            available: true,
            attachable: true,
            participant_count: 2,
            controller_participant_id: "participant-1",
            has_upstream: true,
          },
        },
      ]),
      { headers: { "Content-Type": "application/json" }, status: 200 },
    );
  };
  try {
    const client = new RstreamTunnelsClient({
      credentials: { token: "token" },
      engine: "project-endpoint.cluster.example.rstream.test:443",
    });
    const sessions = await client.webtty.listSessions({
      filters: { server_id: "server-1", status: "active" },
      limit: 10,
    });
    assert.equal(sessions[0].id, "session-1");
    assert.equal(sessions[0].live.available, true);
    assert.equal(sessions[0].live.attachable, true);
    assert.equal(sessions[0].live.participant_count, 2);
    assert.equal(sessions[0].live.controller_participant_id, "participant-1");
    assert.equal(sessions[0].live.has_upstream, true);
    assert.deepEqual(calls, [
      {
        authorization: "Bearer token",
        method: "GET",
        url: "https://project-endpoint.cluster.example.rstream.test:443/api/webtty/sessions?params=%7B%22limit%22%3A10%2C%22filters%22%3A%7B%22server_id%22%3A%22server-1%22%2C%22status%22%3A%22active%22%7D%7D",
      },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("webtty resource reads encrypted session events", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input, init) => {
    assert.equal(init.method, "GET");
    assert.equal(
      input.toString(),
      "https://project-endpoint.cluster.example.rstream.test:443/api/webtty/sessions/session-1/events?params=%7B%22from_seq%22%3A%227%22%2C%22limit%22%3A2%7D",
    );
    return new Response(
      JSON.stringify([
        {
          id: "event-1",
          session_id: "session-1",
          seq: "9223372036854775815",
          created_at: "2026-06-06T12:00:01Z",
          type: "data",
          direction: "server_to_client",
          stream_type: "stdout",
          payload_length: 5,
          payload_ciphertext: "Y2lwaGVy",
          payload_plaintext: "aGVsbG8=",
          crypto: {
            payload_suite: "aes-256-gcm",
            nonce: "bm9uY2U",
          },
        },
      ]),
      { headers: { "Content-Type": "application/json" }, status: 200 },
    );
  };
  try {
    const client = new RstreamTunnelsClient({
      credentials: { token: "token" },
      engine: "project-endpoint.cluster.example.rstream.test:443",
    });
    const events = await client.webtty.readEvents("session-1", {
      from_seq: 7,
      limit: 2,
    });
    assert.equal(events[0].seq, "9223372036854775815");
    assert.equal(events[0].payload_ciphertext, "Y2lwaGVy");
    assert.equal(events[0].payload_plaintext, "aGVsbG8=");
    assert.equal(events[0].crypto.payload_suite, "aes-256-gcm");
  } finally {
    global.fetch = originalFetch;
  }
});

test("webtty session event schema exposes only emitted recording event types", () => {
  const baseEvent = {
    id: "event-1",
    session_id: "session-1",
    seq: "1",
    created_at: "2026-06-06T12:00:01Z",
    direction: "engine_internal",
  };
  assert.equal(
    webTTYSessionEventSchema.safeParse({
      ...baseEvent,
      type: "recording_state",
    }).success,
    true,
  );
  for (const type of ["key_grant", "policy_decision"]) {
    assert.equal(
      webTTYSessionEventSchema.safeParse({ ...baseEvent, type }).success,
      false,
    );
  }
});

test("webtty session event schema rejects key envelopes", () => {
  assert.equal(
    webTTYSessionEventSchema.safeParse({
      id: "event-1",
      session_id: "session-1",
      seq: "1",
      created_at: "2026-06-06T12:00:01Z",
      type: "data",
      direction: "server_to_client",
      stream_type: "stdout",
      crypto: {
        key_envelopes: [
          {
            encapsulated_key: "BAUG",
            recipient_key_id: "device-1",
          },
        ],
        payload_suite: "aes-256-gcm",
      },
    }).success,
    false,
  );
});

test("webtty resource lists session key grants", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input, init) => {
    assert.equal(init.method, "GET");
    assert.equal(
      input.toString(),
      "https://project-endpoint.cluster.example.rstream.test:443/api/webtty/sessions/session-1/key-grants",
    );
    return new Response(
      JSON.stringify([
        {
          id: "grant-1",
          session_id: "session-1",
          recipient_id: "recipient-1",
          recipient_kind: "public_key",
          granted_by: "participant-1",
          crypto: {
            key_context: { encoding: "base64", value: "Y3R4" },
            key_envelope_suite: "hpke-x25519-hkdf-sha256-aes-256-gcm",
            payload_key_id: "cGF5bG9hZC1rZXk",
            payload_suite: "aes-256-gcm",
          },
          created_at: "2026-06-06T12:00:01Z",
        },
      ]),
      { headers: { "Content-Type": "application/json" }, status: 200 },
    );
  };
  try {
    const client = new RstreamTunnelsClient({
      credentials: { token: "token" },
      engine: "project-endpoint.cluster.example.rstream.test:443",
    });
    const grants = await client.webtty.listKeyGrants("session-1");
    assert.equal(grants.length, 1);
    assert.equal(grants[0].recipient_id, "recipient-1");
    assert.equal(
      grants[0].crypto.key_envelope_suite,
      "hpke-x25519-hkdf-sha256-aes-256-gcm",
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("webtty key grant metadata schema rejects decrypt material", () => {
  assert.equal(
    webTTYKeyGrantSchema.safeParse({
      id: "grant-1",
      session_id: "session-1",
      recipient_id: "recipient-1",
      recipient_kind: "public_key",
      wrapped_key: "AQID",
      crypto: {
        key_envelope_suite: "hpke-x25519-hkdf-sha256-aes-256-gcm",
        payload_key_id: "cGF5bG9hZC1rZXk",
        payload_suite: "aes-256-gcm",
      },
      created_at: "2026-06-06T12:00:01Z",
    }).success,
    false,
  );
  assert.equal(
    webTTYKeyGrantSchema.safeParse({
      id: "grant-1",
      session_id: "session-1",
      recipient_id: "recipient-1",
      recipient_kind: "public_key",
      crypto: {
        key_envelope_suite: "hpke-x25519-hkdf-sha256-aes-256-gcm",
        key_envelopes: [
          {
            encapsulated_key: "BAUG",
            recipient_key_id: "recipient-1",
          },
        ],
        payload_key_id: "cGF5bG9hZC1rZXk",
        payload_suite: "aes-256-gcm",
      },
      created_at: "2026-06-06T12:00:01Z",
    }).success,
    false,
  );
});

test("webtty resource lists session key grant decrypt material", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input, init) => {
    assert.equal(init.method, "GET");
    const url = new URL(input.toString());
    assert.equal(
      `${url.origin}${url.pathname}`,
      "https://project-endpoint.cluster.example.rstream.test/api/webtty/sessions/session%2F1/key-grants/decrypt-material",
    );
    assert.deepEqual(JSON.parse(url.searchParams.get("params")), {
      recipient_id: "device-1",
      recipient_kind: "workspace_device",
    });
    return new Response(
      JSON.stringify([
        {
          id: "grant-1",
          session_id: "session/1",
          recipient_id: "device-1",
          recipient_kind: "workspace_device",
          wrapped_key: "AQID",
          crypto: {
            key_context_raw: "Y3R4",
            key_envelope_suite: "hpke-x25519-hkdf-sha256-aes-256-gcm",
            key_envelopes: [
              {
                encapsulated_key: "BAUG",
                recipient_key_id: "device-1",
              },
            ],
            payload_key_id: "cGF5bG9hZC1rZXk",
            payload_suite: "aes-256-gcm",
          },
          created_at: "2026-06-06T12:00:01Z",
        },
      ]),
      { headers: { "Content-Type": "application/json" }, status: 200 },
    );
  };
  try {
    const client = new RstreamTunnelsClient({
      credentials: { token: "token" },
      engine: "project-endpoint.cluster.example.rstream.test:443",
    });
    const grants = await client.webtty.listKeyGrantDecryptMaterial(
      "session/1",
      {
        recipient_id: "device-1",
        recipient_kind: "workspace_device",
      },
    );
    assert.equal(grants.length, 1);
    assert.equal(grants[0].wrapped_key, "AQID");
    assert.equal(grants[0].crypto.key_context_raw, "Y3R4");
  } finally {
    global.fetch = originalFetch;
  }
});

test("webtty resource creates and resolves control requests", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (input, init) => {
    calls.push({
      body: JSON.parse(init.body),
      method: init.method,
      url: input.toString(),
    });
    const status = calls.length === 1 ? "pending" : "granted";
    return new Response(
      JSON.stringify({
        id: "request-1",
        session_id: "session-1",
        requester_participant_id: "participant-1",
        status,
        created_at: "2026-06-06T12:00:01Z",
        updated_at: "2026-06-06T12:00:02Z",
      }),
      { headers: { "Content-Type": "application/json" }, status: 200 },
    );
  };
  try {
    const client = new RstreamTunnelsClient({
      credentials: { token: "token" },
      engine: "project-endpoint.cluster.example.rstream.test:443",
    });
    const request = await client.webtty.createControlRequest("session-1", {
      participant_id: "participant-1",
      reason: "handoff",
    });
    assert.equal(request.status, "pending");
    const resolved = await client.webtty.resolveControlRequest(
      "session-1",
      "request-1",
      { action: "grant" },
    );
    assert.equal(resolved.status, "granted");
    await assert.rejects(() =>
      client.webtty.resolveControlRequest("session-1", "request-1", {
        action: "approve",
      }),
    );
    assert.deepEqual(calls, [
      {
        body: { participant_id: "participant-1", reason: "handoff" },
        method: "POST",
        url: "https://project-endpoint.cluster.example.rstream.test:443/api/webtty/sessions/session-1/control-requests",
      },
      {
        body: { action: "grant" },
        method: "POST",
        url: "https://project-endpoint.cluster.example.rstream.test:443/api/webtty/sessions/session-1/control-requests/request-1",
      },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("webtty resource attaches and detaches session participants", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (input, init) => {
    calls.push({
      body: JSON.parse(init.body),
      method: init.method,
      url: input.toString(),
    });
    const detached = calls.length === 2;
    return new Response(
      JSON.stringify({
        id: "participant-1",
        session_id: "session-1",
        user_id: "user-1",
        device_id: "device-1",
        browser_id: "browser-1",
        role: "spectator",
        attached_at: "2026-06-06T12:00:01Z",
        detached_at: detached ? "2026-06-06T12:00:05Z" : undefined,
        controller: false,
        grant_state: detached ? "detached" : "attached",
        attach_grant: detached ? undefined : "Z3JhbnQ=",
        attach_grant_expires_at: detached ? undefined : "2026-06-06T12:00:31Z",
        live: {
          connected: !detached,
          controller: false,
        },
      }),
      { headers: { "Content-Type": "application/json" }, status: 200 },
    );
  };
  try {
    const client = new RstreamTunnelsClient({
      credentials: { token: "token" },
      engine: "project-endpoint.cluster.example.rstream.test:443",
    });
    const attached = await client.webtty.attachParticipant("session-1", {
      browser_id: "browser-1",
      device_id: "device-1",
      grant_state: "requested",
      role: "spectator",
      transport: "websocket",
    });
    assert.equal(attached.id, "participant-1");
    assert.equal(attached.attach_grant, "Z3JhbnQ=");
    assert.equal(attached.attach_grant_expires_at, "2026-06-06T12:00:31Z");
    assert.equal(attached.detached_at, undefined);
    assert.equal(attached.live.connected, true);
    assert.equal(attached.live.controller, false);
    const detached = await client.webtty.detachParticipant(
      "session-1",
      "participant-1",
      { reason: "closed" },
    );
    assert.equal(detached.detached_at, "2026-06-06T12:00:05Z");
    assert.equal(detached.live.connected, false);
    assert.deepEqual(calls, [
      {
        body: {
          browser_id: "browser-1",
          device_id: "device-1",
          grant_state: "requested",
          role: "spectator",
          transport: "websocket",
        },
        method: "POST",
        url: "https://project-endpoint.cluster.example.rstream.test:443/api/webtty/sessions/session-1/participants",
      },
      {
        body: { reason: "closed" },
        method: "POST",
        url: "https://project-endpoint.cluster.example.rstream.test:443/api/webtty/sessions/session-1/participants/participant-1",
      },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
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
