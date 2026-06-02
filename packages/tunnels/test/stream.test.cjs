// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const test = require("node:test");

const { projectLogEventsSchema } = require("../dist/index.js");
const { streamSummarySchema } = require("../dist/index.js");
const { webhookEventsSchema } = require("../dist/index.js");

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

test("webhookEventsSchema rejects stream summary logs", () => {
  assert.throws(() =>
    webhookEventsSchema.parse({
      type: "stream.summary",
      object: streamSummary,
    }),
  );
});
