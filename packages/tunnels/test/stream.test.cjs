// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const test = require("node:test");

const formatStreamAccessPath =
  require("../dist/index.js").formatStreamAccessPath;
const projectLogEventsSchema =
  require("../dist/index.js").projectLogEventsSchema;
const streamSummarySchema = require("../dist/index.js").streamSummarySchema;
const webhookEventsSchema = require("../dist/index.js").webhookEventsSchema;
const wsEventsSchema = require("../dist/index.js").wsEventsSchema;

const streamSummary = {
  stream_id: "stream-id",
  created_at: "2026-04-15T12:00:00Z",
  terminated_at: "2026-04-15T12:00:01Z",
  request: {
    downstream: {
      ip: "127.0.0.1",
      tls: {
        version: "tls1.3",
        cipher: "TLS_AES_128_GCM_SHA256",
      },
    },
  },
  firewall: {
    decision: "allowed",
    rule: {
      kind: "none",
    },
  },
  routing: {
    decision: "routed",
    tunnel: {
      tunnelId: "tunnel-id",
      hostname: "app-project.t.cluster.example.test",
      protocol: "quic",
      type: "datagram",
      published: true,
      upstreamTls: true,
    },
  },
  response: {
    outcome: "connected",
    established_at: "2026-04-15T12:00:00Z",
    upstream: {
      ip: "127.0.0.1",
      tls: {
        version: "tls1.3",
        cipher: "TLS_AES_128_GCM_SHA256",
      },
    },
    metrics: {
      establish_ms: 4,
      duration_ms: 1000,
      upstream_bytes: 42,
      downstream_bytes: 84,
    },
  },
};

test("streamSummarySchema preserves TLS details on endpoints", () => {
  const parsed = streamSummarySchema.parse(streamSummary);
  assert.deepEqual(parsed.request.downstream.tls, {
    version: "tls1.3",
    cipher: "TLS_AES_128_GCM_SHA256",
  });
  assert.deepEqual(parsed.response.upstream.tls, {
    version: "tls1.3",
    cipher: "TLS_AES_128_GCM_SHA256",
  });
});

test("streamSummarySchema preserves routed tunnel stable domain fields", () => {
  const parsed = streamSummarySchema.parse(streamSummary);
  assert.equal(
    parsed.routing.tunnel.hostname,
    "app-project.t.cluster.example.test",
  );
  assert.equal(parsed.routing.tunnel.upstreamTls, true);
});

test("streamSummarySchema preserves distributed routing paths", () => {
  const parsed = streamSummarySchema.parse({
    ...streamSummary,
    routing: {
      ...streamSummary.routing,
      path: {
        mode: "direct",
        crossRegionRoutingAllowed: true,
        ingress: { engineId: "engine-ingress", region: "eu-west-3" },
        owner: { engineId: "engine-owner", region: "us-east-1" },
        agentTarget: { engineId: "engine-ingress", region: "eu-west-3" },
      },
    },
  });
  assert.equal(parsed.routing.path.mode, "direct");
  assert.equal(parsed.routing.path.crossRegionRoutingAllowed, true);
  assert.equal(parsed.routing.path.ingress.engineId, "engine-ingress");
  assert.equal(parsed.routing.path.owner.region, "us-east-1");
  assert.equal(parsed.routing.path.agentTarget.engineId, "engine-ingress");
});

test("streamSummarySchema accepts private rstream entry metadata", () => {
  const parsed = streamSummarySchema.parse({
    ...streamSummary,
    request: {
      ...streamSummary.request,
      entry: {
        kind: "private_rstream",
        transport: "rstream",
      },
    },
    firewall: {
      decision: "allowed",
      rule: {
        kind: "rstream",
        source: "private_rstream",
      },
    },
  });
  assert.deepEqual(parsed.request.entry, {
    kind: "private_rstream",
    transport: "rstream",
  });
  assert.deepEqual(parsed.firewall.rule, {
    kind: "rstream",
    source: "private_rstream",
  });
});

test("streamSummarySchema accepts every stream entry kind used by dashboards", () => {
  for (const kind of [
    "published_tunnel",
    "private_rstream",
    "proxy_egress",
    "internal",
  ]) {
    const parsed = streamSummarySchema.parse({
      ...streamSummary,
      request: {
        ...streamSummary.request,
        entry: { kind },
      },
    });
    assert.equal(parsed.request.entry.kind, kind);
  }
});

test("formatStreamAccessPath exposes dashboard-safe access labels", () => {
  assert.equal(
    formatStreamAccessPath({ kind: "published_tunnel" }),
    "Public URL",
  );
  assert.equal(
    formatStreamAccessPath({ kind: "private_rstream" }),
    "Private rstream dial",
  );
  assert.equal(
    formatStreamAccessPath({ kind: "proxy_egress" }),
    "Proxy egress",
  );
  assert.equal(formatStreamAccessPath({ kind: "internal" }), "Internal");
  assert.equal(formatStreamAccessPath(undefined), undefined);
});

test("streamSummarySchema preserves WebTTY metadata", () => {
  const parsed = streamSummarySchema.parse({
    ...streamSummary,
    webtty: {
      server_id: "server-1",
      session_id: "session-1",
      session_group_id: "group-1",
      participant_id: "participant-1",
      participant_role: "controller",
      controller: true,
      recording_mode: "recorded",
      encryption_mode: "e2e",
      encryption_policy: "workspace_managed",
      e2e: true,
      client_proof: "required",
      session_mode: "interactive",
      downstream_transport: "websocket",
      upstream_transport: "websocket",
      origin: "human",
      origin_id: "browser-tab-1",
      initiator_kind: "user",
      device_id: "device-1",
      browser_id: "browser-1",
    },
  });
  assert.equal(parsed.webtty.server_id, "server-1");
  assert.equal(parsed.webtty.session_id, "session-1");
  assert.equal(parsed.webtty.session_group_id, "group-1");
  assert.equal(parsed.webtty.participant_id, "participant-1");
  assert.equal(parsed.webtty.participant_role, "controller");
  assert.equal(parsed.webtty.controller, true);
  assert.equal(parsed.webtty.recording_mode, "recorded");
  assert.equal(parsed.webtty.encryption_mode, "e2e");
  assert.equal(parsed.webtty.encryption_policy, "workspace_managed");
  assert.equal(parsed.webtty.e2e, true);
  assert.equal(parsed.webtty.client_proof, "required");
  assert.equal(parsed.webtty.session_mode, "interactive");
  assert.equal(parsed.webtty.downstream_transport, "websocket");
  assert.equal(parsed.webtty.upstream_transport, "websocket");
  assert.equal(parsed.webtty.origin, "human");
  assert.equal(parsed.webtty.origin_id, "browser-tab-1");
  assert.equal(parsed.webtty.initiator_kind, "user");
  assert.equal(parsed.webtty.device_id, "device-1");
  assert.equal(parsed.webtty.browser_id, "browser-1");
});

test("streamSummarySchema rejects unknown WebTTY enum values", () => {
  assert.equal(
    streamSummarySchema.safeParse({
      ...streamSummary,
      webtty: {
        server_id: "server-1",
        session_id: "session-1",
        encryption_policy: "manual_key",
      },
    }).success,
    false,
  );
  assert.equal(
    streamSummarySchema.safeParse({
      ...streamSummary,
      webtty: {
        server_id: "server-1",
        session_id: "session-1",
        client_proof: "optional",
      },
    }).success,
    false,
  );
});

test("projectLogEventsSchema preserves stream summary TLS details", () => {
  const parsed = projectLogEventsSchema.parse({
    type: "stream.summary",
    object: streamSummary,
  });
  assert.equal(parsed.type, "stream.summary");
  assert.equal(parsed.object.request.downstream.tls.version, "tls1.3");
  assert.equal(
    parsed.object.response.upstream.tls.cipher,
    "TLS_AES_128_GCM_SHA256",
  );
});

test("projectLogEventsSchema preserves stream summary WebTTY metadata", () => {
  const parsed = projectLogEventsSchema.parse({
    type: "stream.summary",
    object: {
      ...streamSummary,
      webtty: {
        server_id: "server-1",
        session_id: "session-1",
        session_group_id: "group-1",
        participant_id: "participant-1",
        participant_role: "controller",
        controller: true,
        recording_mode: "recorded",
        encryption_mode: "e2e",
        encryption_policy: "explicit_key",
        e2e: true,
        client_proof: "required",
        session_mode: "interactive",
        downstream_transport: "plain",
        upstream_transport: "plain",
        origin: "api",
        origin_id: "mcp-request-1",
        initiator_kind: "service-account",
        device_id: "device-1",
        browser_id: "browser-1",
      },
    },
  });
  assert.equal(parsed.type, "stream.summary");
  assert.equal(parsed.object.webtty.server_id, "server-1");
  assert.equal(parsed.object.webtty.session_group_id, "group-1");
  assert.equal(parsed.object.webtty.participant_role, "controller");
  assert.equal(parsed.object.webtty.controller, true);
  assert.equal(parsed.object.webtty.encryption_policy, "explicit_key");
  assert.equal(parsed.object.webtty.e2e, true);
  assert.equal(parsed.object.webtty.client_proof, "required");
  assert.equal(parsed.object.webtty.downstream_transport, "plain");
  assert.equal(parsed.object.webtty.origin, "api");
  assert.equal(parsed.object.webtty.initiator_kind, "service-account");
  assert.equal(parsed.object.webtty.device_id, "device-1");
  assert.equal(parsed.object.webtty.browser_id, "browser-1");
});

test("webhookEventsSchema rejects stream summary logs", () => {
  assert.throws(() =>
    webhookEventsSchema.parse({
      type: "stream.summary",
      object: streamSummary,
    }),
  );
});

test("WebTTY control request events are parsed by watch and webhook schemas", () => {
  const event = {
    id: "event-1",
    type: "webtty.control.requested",
    created_at: "2026-06-09T12:00:00Z",
    workspace_id: "workspace-1",
    project_id: "project-1",
    cluster_id: "cluster-1",
    user_id: "user-1",
    object: {
      id: "request-1",
      session_id: "session-1",
      requester_participant_id: "participant-1",
      requester_user_id: "user-1",
      status: "pending",
      reason: "handoff",
      created_at: "2026-06-09T12:00:00Z",
      updated_at: "2026-06-09T12:00:00Z",
    },
  };
  assert.equal(wsEventsSchema.parse(event).object.status, "pending");
  assert.equal(webhookEventsSchema.parse(event).object.session_id, "session-1");
});

test("WebTTY session group events are parsed by watch and webhook schemas", () => {
  const event = {
    id: "event-1",
    type: "webtty.session.updated",
    created_at: "2026-06-09T12:00:00Z",
    workspace_id: "workspace-1",
    project_id: "project-1",
    user_id: "user-1",
    object: {
      id: "group-1",
      workspace_id: "workspace-1",
      project_id: "project-1",
      initiator_user_id: "user-1",
      context: {
        origin: "codex",
        purpose: "fleet audit",
      },
      created_at: "2026-06-09T12:00:00Z",
      updated_at: "2026-06-09T12:00:01Z",
      closed_at: "2026-06-09T12:00:02Z",
    },
  };
  assert.equal(wsEventsSchema.parse(event).object.id, "group-1");
  assert.equal(
    webhookEventsSchema.parse(event).object.closed_at,
    "2026-06-09T12:00:02Z",
  );
});

test("WebTTY participant events are parsed by watch and webhook schemas", () => {
  const event = {
    id: "event-1",
    type: "webtty.participant.joined",
    created_at: "2026-06-09T12:00:00Z",
    workspace_id: "workspace-1",
    project_id: "project-1",
    user_id: "user-1",
    object: {
      id: "participant-1",
      session_id: "session-1",
      user_id: "user-1",
      device_id: "device-1",
      role: "spectator",
      attached_at: "2026-06-09T12:00:00Z",
      controller: false,
    },
  };
  assert.equal(wsEventsSchema.parse(event).object.role, "spectator");
  assert.equal(webhookEventsSchema.parse(event).object.device_id, "device-1");
});

test("WebTTY reserved future events are not accepted by watch or webhook schemas", () => {
  const event = {
    id: "event-1",
    created_at: "2026-06-09T12:00:00Z",
    workspace_id: "workspace-1",
    project_id: "project-1",
    object: {},
  };
  for (const type of [
    "webtty.control.takeover",
    "webtty.key_grant.created",
    "webtty.key_grant.revoked",
    "webtty.policy.decision",
    "webtty.recording.available",
    "webtty.recording.unavailable",
  ]) {
    assert.equal(wsEventsSchema.safeParse({ ...event, type }).success, false);
    assert.equal(
      webhookEventsSchema.safeParse({ ...event, type }).success,
      false,
    );
  }
});
