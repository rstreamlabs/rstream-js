// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createTunnelsWebhookParamsSchema,
  RstreamClient,
  tunnelsWebhookEndpointSchema,
} = require("../dist/index.js");

const createdAt = "2026-06-02T12:00:00.000Z";

function webhookEndpoint(overrides = {}) {
  return {
    config: { url: "https://example.com/rstream/webhook" },
    createdAt,
    createdByUserId: "user-id",
    deletedAt: null,
    description: "Lifecycle sink",
    destinationType: "webhook_endpoint",
    events: ["tunnel.created", "tunnel.deleted"],
    id: "webhook-id",
    name: "Lifecycle sink",
    previousSecretExpiresAt: null,
    projectId: "project-id",
    secretLastRotatedAt: createdAt,
    status: "enabled",
    updatedAt: createdAt,
    workspaceId: "workspace-id",
    ...overrides,
  };
}

function projectEvent(overrides = {}) {
  return {
    clusterId: "cluster-id",
    createdAt,
    eventCategory: "lifecycle",
    eventId: "event-id",
    eventType: "tunnel.created",
    expiresAt: "2026-07-02T12:00:00.000Z",
    id: "row-id",
    payload: { id: "event-id", type: "tunnel.created" },
    projectId: "project-id",
    updatedAt: createdAt,
    userId: "user-id",
    workspaceId: "workspace-id",
    ...overrides,
  };
}

function webhookDelivery(overrides = {}) {
  return {
    attemptCount: 1,
    attempts: [
      {
        attemptNumber: 1,
        completedAt: createdAt,
        createdAt,
        deliveryId: "delivery-id",
        errorCode: null,
        errorMessage: null,
        httpStatus: 200,
        id: "attempt-id",
        responseBody: "{\"ok\":true}",
        responseHeaders: { "content-type": ["application/json"] },
        responseTimeMs: 42,
        startedAt: createdAt,
        status: "succeeded",
      },
    ],
    createdAt,
    eventId: "event-id",
    eventType: "tunnel.created",
    failedAt: null,
    id: "delivery-id",
    lastAttemptAt: createdAt,
    lastError: null,
    lastHttpStatus: 200,
    lastResponseTimeMs: 42,
    nextAttemptAt: null,
    projectId: "project-id",
    requestBody: { id: "event-id", type: "tunnel.created" },
    status: "succeeded",
    succeededAt: createdAt,
    updatedAt: createdAt,
    webhookEndpointId: "webhook-id",
    workspaceId: "workspace-id",
    ...overrides,
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

test("tunnels webhook schemas keep destination configs typed by destination", () => {
  const awsEndpoint = webhookEndpoint({
    config: { eventBusArn: "arn:aws:events:eu-west-3:123:event-bus/default" },
    destinationType: "amazon_eventbridge",
  });
  const azureEndpoint = webhookEndpoint({
    config: { topicEndpoint: "https://topic.eventgrid.azure.net/api/events" },
    destinationType: "azure_event_grid",
  });
  assert.equal(
    tunnelsWebhookEndpointSchema.parse(awsEndpoint).config.eventBusArn,
    "arn:aws:events:eu-west-3:123:event-bus/default",
  );
  assert.equal(
    tunnelsWebhookEndpointSchema.parse(azureEndpoint).config.topicEndpoint,
    "https://topic.eventgrid.azure.net/api/events",
  );
  assert.throws(() =>
    tunnelsWebhookEndpointSchema.parse(webhookEndpoint({
      config: {
        eventBusArn: "arn:aws:events:eu-west-3:123:event-bus/default",
        url: "https://example.com/rstream/webhook",
      },
    })),
  );
  assert.throws(() =>
    createTunnelsWebhookParamsSchema.parse({
      config: { url: "https://example.com/rstream/webhook" },
      destinationType: "amazon_eventbridge",
      events: ["tunnel.created"],
      name: "Wrong destination config",
    }),
  );
  assert.throws(() =>
    createTunnelsWebhookParamsSchema.parse({
      config: { url: "http://example.com/rstream/webhook" },
      events: ["tunnel.created"],
      name: "Insecure endpoint",
    }),
  );
  assert.throws(() =>
    createTunnelsWebhookParamsSchema.parse({
      config: { url: "https://token@example.com/rstream/webhook" },
      events: ["tunnel.created"],
      name: "Credential endpoint",
    }),
  );
});

test("tunnels webhook project methods use typed routes, queries, and bodies", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  const projectID = "project/with space";
  const webhookID = "webhook/with space";
  const deliveryID = "delivery/with space";
  global.fetch = async (input, init) => {
    const url = new URL(input.toString());
    calls.push({
      authorization: init.headers.get("Authorization"),
      body: init.body === undefined ? undefined : String(init.body),
      contentType: init.headers.get("Content-Type"),
      method: init.method,
      pathname: url.pathname,
      query: url.search,
    });
    const projectPrefix = "/api/projects/tunnels/project%2Fwith%20space";
    const webhookPath = `${projectPrefix}/webhooks/webhook%2Fwith%20space`;
    const deliveryPath = `${webhookPath}/deliveries/delivery%2Fwith%20space`;
    if (init.method === "GET" && url.pathname === `${projectPrefix}/webhooks`) {
      return jsonResponse({
        page: 2,
        pageSize: 10,
        total: 1,
        totalPages: 1,
        webhooks: [webhookEndpoint()],
      });
    }
    if (init.method === "GET" && url.pathname === `${projectPrefix}/events`) {
      return jsonResponse({
        events: [projectEvent()],
        page: 2,
        pageSize: 10,
        total: 1,
        totalPages: 1,
      });
    }
    if (init.method === "POST" && url.pathname === `${projectPrefix}/webhooks`) {
      return jsonResponse({
        ...webhookEndpoint(),
        signingSecret: "whsec_clear",
      });
    }
    if (init.method === "GET" && url.pathname === webhookPath) {
      return jsonResponse(webhookEndpoint());
    }
    if (init.method === "PATCH" && url.pathname === webhookPath) {
      return jsonResponse(webhookEndpoint({ name: "Updated sink" }));
    }
    if (init.method === "POST" && url.pathname === `${webhookPath}/secret/rotate`) {
      return jsonResponse({
        ...webhookEndpoint(),
        signingSecret: "whsec_rotated",
      });
    }
    if (init.method === "GET" && url.pathname === `${webhookPath}/deliveries`) {
      return jsonResponse({
        deliveries: [webhookDelivery()],
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      });
    }
    if (init.method === "GET" && url.pathname === deliveryPath) {
      return jsonResponse(webhookDelivery());
    }
    if (init.method === "DELETE" && url.pathname === webhookPath) {
      return jsonResponse(webhookEndpoint({ status: "disabled" }));
    }
    return jsonResponse({ error: "unexpected route" }, 404);
  };
  try {
    const client = new RstreamClient({
      apiUrl: "https://rstream.io",
      credentials: { token: "token" },
    });
    const events = await client.tunnels.projects.listEvents(projectID, {
      afterEventId: "event-0",
      eventType: "tunnel.created",
      order: "desc",
      page: 2,
      pageSize: 10,
      timeline: "24h",
    });
    const webhooks = await client.tunnels.projects.listWebhooks(projectID, {
      destinationType: "webhook_endpoint",
      order: "desc",
      page: 2,
      pageSize: 10,
      q: " lifecycle ",
      sort: "createdAt",
      status: "enabled",
    });
    const created = await client.tunnels.projects.createWebhook(projectID, {
      config: { url: "https://example.com/rstream/webhook" },
      events: ["tunnel.created", "tunnel.deleted"],
      name: "Lifecycle sink",
    });
    const webhook = await client.tunnels.projects.getWebhook(projectID, webhookID);
    const updated = await client.tunnels.projects.updateWebhook(projectID, webhookID, {
      config: { url: "https://example.com/rstream/updated" },
      name: "Updated sink",
    });
    const rotated = await client.tunnels.projects.rotateWebhookSecret(
      projectID,
      webhookID,
    );
    const deliveries = await client.tunnels.projects.listWebhookDeliveries(
      projectID,
      webhookID,
      {
        end: "2026-06-02T13:00:00.000Z",
        eventType: "tunnel.created",
        order: "desc",
        page: 1,
        pageSize: 20,
        start: "2026-06-02T12:00:00.000Z",
        status: "succeeded",
      },
    );
    const delivery = await client.tunnels.projects.getWebhookDelivery(
      projectID,
      webhookID,
      deliveryID,
    );
    const deleted = await client.tunnels.projects.deleteWebhook(projectID, webhookID);
    assert.equal(events.events[0].eventType, "tunnel.created");
    assert.equal(events.events[0].payload.type, "tunnel.created");
    assert.equal(webhooks.webhooks.length, 1);
    assert.equal(created.signingSecret, "whsec_clear");
    assert.equal(webhook.id, "webhook-id");
    assert.equal(updated.name, "Updated sink");
    assert.equal(rotated.signingSecret, "whsec_rotated");
    assert.deepEqual(deliveries.deliveries[0].attempts[0].responseHeaders["content-type"], ["application/json"]);
    assert.equal(delivery.requestBody.type, "tunnel.created");
    assert.equal(deleted.status, "disabled");
    assert.deepEqual(calls.map((call) => [call.method, call.pathname, call.query]), [
      [
        "GET",
        "/api/projects/tunnels/project%2Fwith%20space/events",
        "?timeline=24h&eventType=tunnel.created&afterEventId=event-0&page=2&pageSize=10&order=desc",
      ],
      [
        "GET",
        "/api/projects/tunnels/project%2Fwith%20space/webhooks",
        "?q=lifecycle&status=enabled&destinationType=webhook_endpoint&page=2&pageSize=10&sort=createdAt&order=desc",
      ],
      ["POST", "/api/projects/tunnels/project%2Fwith%20space/webhooks", ""],
      [
        "GET",
        "/api/projects/tunnels/project%2Fwith%20space/webhooks/webhook%2Fwith%20space",
        "",
      ],
      [
        "PATCH",
        "/api/projects/tunnels/project%2Fwith%20space/webhooks/webhook%2Fwith%20space",
        "",
      ],
      [
        "POST",
        "/api/projects/tunnels/project%2Fwith%20space/webhooks/webhook%2Fwith%20space/secret/rotate",
        "",
      ],
      [
        "GET",
        "/api/projects/tunnels/project%2Fwith%20space/webhooks/webhook%2Fwith%20space/deliveries",
        "?status=succeeded&eventType=tunnel.created&start=2026-06-02T12%3A00%3A00.000Z&end=2026-06-02T13%3A00%3A00.000Z&page=1&pageSize=20&order=desc",
      ],
      [
        "GET",
        "/api/projects/tunnels/project%2Fwith%20space/webhooks/webhook%2Fwith%20space/deliveries/delivery%2Fwith%20space",
        "",
      ],
      [
        "DELETE",
        "/api/projects/tunnels/project%2Fwith%20space/webhooks/webhook%2Fwith%20space",
        "",
      ],
    ]);
    assert.equal(calls[2].body, '{"name":"Lifecycle sink","events":["tunnel.created","tunnel.deleted"],"config":{"url":"https://example.com/rstream/webhook"},"destinationType":"webhook_endpoint"}');
    assert.equal(calls[4].body, '{"name":"Updated sink","config":{"url":"https://example.com/rstream/updated"}}');
  } finally {
    global.fetch = originalFetch;
  }
});

test("tunnels webhook project methods reject blank identifiers before IO", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (input) => {
    calls.push(input.toString());
    return jsonResponse({});
  };
  try {
    const client = new RstreamClient({
      apiUrl: "https://rstream.io",
      credentials: { token: "token" },
    });
    await assert.rejects(
      () => client.tunnels.projects.listWebhooks(" "),
      /Project ID is required/,
    );
    await assert.rejects(
      () => client.tunnels.projects.listEvents(" "),
      /Project ID is required/,
    );
    await assert.rejects(
      () => client.tunnels.projects.getWebhook("project-id", " "),
      /Webhook ID is required/,
    );
    await assert.rejects(
      () =>
        client.tunnels.projects.getWebhookDelivery(
          "project-id",
          "webhook-id",
          " ",
        ),
      /Delivery ID is required/,
    );
    assert.deepEqual(calls, []);
  } finally {
    global.fetch = originalFetch;
  }
});
