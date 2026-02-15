// See LICENSE file in the project root for license information.

import * as z from "zod";

const nonEmptyStringSchema = z.string().min(1);

const isoDateTimeSchema = z.string().datetime();

const ipAddressSchema = z.string();

const intNonNegSchema = z.number().int().nonnegative();

const numNonNegSchema = z.number().nonnegative();

const geolocationSchema = z.object({
  country: z.string().optional(),
  region: z.string().optional(),
});

const endpointSchema = z.object({
  ip: ipAddressSchema.optional(),
  geolocation: geolocationSchema.optional(),
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
    kind: z.literal("token"),
    source: tokenSourceSchema.optional(),
    tokenType: tokenTypeSchema.optional(),
  }),
]);

const unauthorizedSchema = z.discriminatedUnion("reason", [
  z.object({
    reason: z.literal("missing_token"),
    source: z.enum(["authorization", "query", "client", "unknown"]),
  }),
  z.object({ reason: z.literal("invalid_token") }),
  z.object({ reason: z.literal("expired_token") }),
  z.object({ reason: z.literal("invalid_secret") }),
  z.object({ reason: z.literal("user_mismatch") }),
  z.object({
    reason: z.literal("policy_denied"),
    policy: z.enum(["ip", "geo", "mtls", "sso", "challenge", "other"]),
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
  protocol: z.string().optional(),
  published: z.boolean().optional(),
  type: z.string().optional(),
  tlsMode: z.string().optional(),
  httpVersion: z.string().optional(),
  httpUseTls: z.boolean().optional(),
  tokenAuth: z.boolean().optional(),
  mtls: z.boolean().optional(),
});

const routingSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("routed"), tunnel: routedTunnelSchema }),
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
  upstream: endpointSchema.optional(),
  metrics: streamConnectedMetricsSchema,
  termination: terminationSchema.optional(),
  http: httpResponseStageSchema.optional(),
});

const responseFailedSchema = z.object({
  outcome: z.literal("failed"),
  failure: failureSchema,
  upstream: endpointSchema.optional(),
  metrics: streamFailedMetricsSchema.optional(),
  termination: terminationSchema.optional(),
  http: httpResponseStageSchema.optional(),
});

const responseSchema = z.discriminatedUnion("outcome", [
  responseConnectedSchema,
  responseFailedSchema,
]);

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
    downstream: endpointSchema,
    http: httpRequestStageSchema.optional(),
  }),
  firewall: firewallSchema,
  routing: routingSchema,
  response: responseSchema,
});

export type StreamSummary = z.infer<typeof streamSummarySchema>;
