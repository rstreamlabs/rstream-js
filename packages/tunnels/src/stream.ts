// See LICENSE file in the project root for license information.

import { webTTYEncryptionModeSchema } from "./webtty-schemas";
import { webTTYInitiatorKindSchema } from "./webtty-schemas";
import { webTTYOriginSchema } from "./webtty-schemas";
import { webTTYParticipantRoleSchema } from "./webtty-schemas";
import { webTTYRecordingModeSchema } from "./webtty-schemas";
import { webTTYSessionModeSchema } from "./webtty-schemas";
import { webTTYTransportSchema } from "./webtty-schemas";
import * as z from "zod";

const nonEmptyStringSchema = z.string().min(1);

const isoDateTimeSchema = z.string().datetime({ offset: true });

const ipAddressSchema = z.string();

const intNonNegSchema = z.number().int().nonnegative();

const numNonNegSchema = z.number().nonnegative();

const geolocationSchema = z.object({
  country: z.string().optional(),
  region: z.string().optional(),
});

export const streamTLSInfoSchema = z.object({
  version: z.string().min(1).optional(),
  cipher: z.string().min(1).optional(),
  protocol: z.string().min(1).optional(),
  curve: z.string().min(1).optional(),
  ech: z.boolean().optional(),
});

export const streamEndpointSchema = z.object({
  ip: ipAddressSchema.optional(),
  geolocation: geolocationSchema.optional(),
  tls: streamTLSInfoSchema.optional(),
});

const httpHeadersSchema = z.record(
  z.string(),
  z.union([z.string(), z.array(z.string())]),
);

const httpProtocolSchema = z.enum(["http/1.1", "h2", "h2c", "h3"]);

const httpRequestSchema = z.object({
  method: nonEmptyStringSchema,
  scheme: z.string().min(1).optional(),
  host: nonEmptyStringSchema.optional(),
  path: nonEmptyStringSchema.optional(),
  query: z.string().optional(),
  url: nonEmptyStringSchema.optional(),
  headers: httpHeadersSchema.optional(),
  userAgent: z.string().optional(),
});

const httpResponseSchema = z.object({
  status: z.number().int().min(100).max(999),
  headers: httpHeadersSchema.optional(),
});

const httpRequestStageSchema = z.object({
  protocol: httpProtocolSchema.optional(),
  request: httpRequestSchema,
});

const httpResponseStageSchema = z.object({
  protocol: httpProtocolSchema.optional(),
  response: httpResponseSchema,
});

export const streamEntrySchema = z.object({
  kind: z.enum([
    "published_tunnel",
    "private_rstream",
    "proxy_egress",
    "internal",
  ]),
  transport: z
    .enum(["rstream", "tls", "quic", "dtls", "http", "tcp"])
    .optional(),
});

const tokenSourceSchema = z.enum([
  "authorization",
  "query",
  "client",
  "unknown",
]);

const tokenTypeSchema = z.enum(["auth", "pat", "app", "unknown"]);

const firewallRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("mtls") }),
  z.object({
    kind: z.literal("rstream_auth"),
    source: z.literal("rstream_auth"),
  }),
  z.object({
    kind: z.literal("rstream"),
    source: z.literal("private_rstream").optional(),
  }),
  z.object({
    kind: z.literal("token"),
    source: tokenSourceSchema.optional(),
    tokenType: tokenTypeSchema.optional(),
  }),
]);

const unauthorizedSourceSchema = z.object({
  source: tokenSourceSchema,
});

const unauthorizedReasonSchema = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).merge(unauthorizedSourceSchema);

const unauthorizedSchema = z.discriminatedUnion("reason", [
  unauthorizedReasonSchema({
    reason: z.literal("missing_token"),
  }),
  unauthorizedReasonSchema({
    reason: z.literal("invalid_token"),
  }),
  unauthorizedReasonSchema({
    reason: z.literal("expired_token"),
  }),
  unauthorizedReasonSchema({
    reason: z.literal("invalid_secret"),
  }),
  unauthorizedReasonSchema({
    reason: z.literal("user_mismatch"),
  }),
  unauthorizedReasonSchema({
    reason: z.literal("insufficient_scope"),
  }),
  unauthorizedReasonSchema({
    reason: z.literal("policy_denied"),
    policy: z.enum(["ip", "geo", "mtls", "challenge", "other"]),
    value: z.string().optional(),
  }),
]);

const failureSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("timeout"),
    timeoutMs: intNonNegSchema.optional(),
    message: z.string().optional(),
  }),
  z.object({
    kind: z.literal("unauthorized"),
    why: unauthorizedSchema,
    message: z.string().optional(),
  }),
  z.object({
    kind: z.literal("not_found"),
    resource: z.enum(["tunnel", "client", "route"]),
    message: z.string().optional(),
  }),
  z.object({
    kind: z.literal("refused"),
    reason: z.enum(["capacity", "policy", "unsupported", "other"]),
    message: z.string().optional(),
  }),
  z.object({ kind: z.literal("io"), message: z.string().optional() }),
  z.object({ kind: z.literal("internal"), message: z.string().optional() }),
]);

const firewallSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("allowed"), rule: firewallRuleSchema }),
  z.object({
    decision: z.literal("denied"),
    rule: firewallRuleSchema,
    failure: failureSchema,
  }),
]);

const routedTunnelSchema = z.object({
  tunnelId: nonEmptyStringSchema.optional(),
  tunnelName: z.string().optional(),
  hostname: z.string().optional(),
  protocol: z.string().optional(),
  published: z.boolean().optional(),
  type: z.string().optional(),
  tlsMode: z.string().optional(),
  httpVersion: z.string().optional(),
  httpUseTls: z.boolean().optional(),
  upstreamTls: z.boolean().optional(),
  tokenAuth: z.boolean().optional(),
  mtls_auth: z.boolean().optional(),
});

const routingNodeSchema = z.object({
  engineId: nonEmptyStringSchema,
  region: nonEmptyStringSchema,
  generation: nonEmptyStringSchema.optional(),
});

const routingPathSchema = z.object({
  mode: z.enum(["direct", "cross_region"]),
  crossRegionRoutingAllowed: z.boolean(),
  ingress: routingNodeSchema,
  owner: routingNodeSchema,
  anchor: routingNodeSchema,
});

const routingSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("routed"),
    tunnel: routedTunnelSchema,
    path: routingPathSchema.optional(),
  }),
  z.object({ decision: z.literal("not_routed"), failure: failureSchema }),
]);

const streamConnectedMetricsSchema = z.object({
  establish_ms: numNonNegSchema,
  duration_ms: numNonNegSchema,
  upstream_bytes: intNonNegSchema,
  downstream_bytes: intNonNegSchema,
});

const streamFailedMetricsSchema = z.object({
  time_to_fail_ms: numNonNegSchema.optional(),
  establish_ms: numNonNegSchema.optional(),
});

const terminationSchema = z.object({
  by: z.enum(["downstream", "upstream", "server", "unknown"]),
  reason: z.enum(["closed", "reset", "timeout", "error", "unknown"]),
  message: z.string().optional(),
});

const responseConnectedSchema = z.object({
  outcome: z.literal("connected"),
  established_at: isoDateTimeSchema,
  upstream: streamEndpointSchema.optional(),
  metrics: streamConnectedMetricsSchema,
  termination: terminationSchema.optional(),
  http: httpResponseStageSchema.optional(),
});

const responseFailedSchema = z.object({
  outcome: z.literal("failed"),
  failure: failureSchema,
  upstream: streamEndpointSchema.optional(),
  metrics: streamFailedMetricsSchema.optional(),
  termination: terminationSchema.optional(),
  http: httpResponseStageSchema.optional(),
});

const responseSchema = z.discriminatedUnion("outcome", [
  responseConnectedSchema,
  responseFailedSchema,
]);

export const streamWebTTYMetadataSchema = z
  .object({
    server_id: nonEmptyStringSchema.optional(),
    session_id: nonEmptyStringSchema.optional(),
    session_group_id: nonEmptyStringSchema.optional(),
    participant_id: nonEmptyStringSchema.optional(),
    participant_role: webTTYParticipantRoleSchema.optional(),
    controller: z.boolean().optional(),
    recording_mode: webTTYRecordingModeSchema.optional(),
    encryption_mode: webTTYEncryptionModeSchema.optional(),
    encryption_policy: z
      .enum(["disabled", "explicit_key", "workspace_managed"])
      .optional(),
    e2e: z.boolean().optional(),
    client_proof: z.enum(["none", "required"]).optional(),
    session_mode: webTTYSessionModeSchema.optional(),
    downstream_transport: webTTYTransportSchema.optional(),
    upstream_transport: webTTYTransportSchema.optional(),
    origin: webTTYOriginSchema.optional(),
    origin_id: z.string().optional(),
    initiator_kind: webTTYInitiatorKindSchema.optional(),
    device_id: z.string().optional(),
    browser_id: z.string().optional(),
  })
  .passthrough();

export const streamSummarySchema = z.object({
  workspace_id: nonEmptyStringSchema.optional(),
  project_id: nonEmptyStringSchema.optional(),
  cluster_id: nonEmptyStringSchema.optional(),
  user_id: nonEmptyStringSchema.optional(),
  client_id: nonEmptyStringSchema.optional(),
  tunnel_id: nonEmptyStringSchema.optional(),
  stream_id: nonEmptyStringSchema,
  created_at: isoDateTimeSchema,
  terminated_at: isoDateTimeSchema,
  request: z.object({
    downstream: streamEndpointSchema,
    entry: streamEntrySchema.optional(),
    http: httpRequestStageSchema.optional(),
  }),
  firewall: firewallSchema,
  routing: routingSchema,
  webtty: streamWebTTYMetadataSchema.optional(),
  response: responseSchema,
});

export type StreamSummary = z.infer<typeof streamSummarySchema>;

export type StreamTLSInfo = z.infer<typeof streamTLSInfoSchema>;

export type StreamEndpoint = z.infer<typeof streamEndpointSchema>;

export type StreamEntry = z.infer<typeof streamEntrySchema>;

export function formatStreamAccessPath(
  entry: Pick<StreamEntry, "kind"> | null | undefined,
): string | undefined {
  if (!entry) return undefined;
  switch (entry.kind) {
    case "published_tunnel":
      return "Public URL";
    case "private_rstream":
      return "Private rstream dial";
    case "proxy_egress":
      return "Proxy egress";
    case "internal":
      return "Internal";
    default:
      return undefined;
  }
}
