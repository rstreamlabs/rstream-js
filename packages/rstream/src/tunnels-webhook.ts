// See LICENSE file in the project root for license information.

import * as z from "zod";

export const tunnelsWebhookEventTypes: [
  "client.created",
  "client.deleted",
  "tunnel.created",
  "tunnel.deleted",
] = ["client.created", "client.deleted", "tunnel.created", "tunnel.deleted"];

export const tunnelsWebhookEventTypeSchema = z.enum(tunnelsWebhookEventTypes);

export const tunnelsWebhookDestinationTypeSchema = z.enum([
  "webhook_endpoint",
  "amazon_eventbridge",
  "azure_event_grid",
]);

export const tunnelsWebhookEndpointStatusSchema = z.enum([
  "enabled",
  "disabled",
]);

export const tunnelsWebhookDeliveryStatusSchema = z.enum([
  "pending",
  "delivering",
  "retrying",
  "succeeded",
  "failed",
  "canceled",
]);

export const tunnelsWebhookDeliveryAttemptStatusSchema = z.enum([
  "succeeded",
  "failed",
  "timeout",
  "network_error",
]);

const tunnelsWebhookEndpointUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "Endpoint URL must use HTTPS and must not include credentials.");

export const tunnelsWebhookEndpointConfigSchema = z
  .object({
    url: tunnelsWebhookEndpointUrlSchema,
  })
  .strict();

export const tunnelsWebhookAmazonEventBridgeConfigSchema = z
  .object({
    eventBusArn: z.string().optional(),
    region: z.string().optional(),
  })
  .strict();

export const tunnelsWebhookAzureEventGridConfigSchema = z
  .object({
    topicEndpoint: z.string().optional(),
  })
  .strict();

export const tunnelsWebhookDestinationConfigSchema = z.union([
  tunnelsWebhookEndpointConfigSchema,
  tunnelsWebhookAmazonEventBridgeConfigSchema,
  tunnelsWebhookAzureEventGridConfigSchema,
]);

const tunnelsWebhookEndpointBaseSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: tunnelsWebhookEndpointStatusSchema,
  events: z.array(tunnelsWebhookEventTypeSchema),
  secretLastRotatedAt: z.string().datetime().nullable(),
  previousSecretExpiresAt: z.string().datetime().nullable(),
  createdByUserId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});

export const tunnelsWebhookEndpointSchema = z.union([
  tunnelsWebhookEndpointBaseSchema.extend({
    config: tunnelsWebhookEndpointConfigSchema,
    destinationType: z.literal("webhook_endpoint"),
  }),
  tunnelsWebhookEndpointBaseSchema.extend({
    config: tunnelsWebhookAmazonEventBridgeConfigSchema,
    destinationType: z.literal("amazon_eventbridge"),
  }),
  tunnelsWebhookEndpointBaseSchema.extend({
    config: tunnelsWebhookAzureEventGridConfigSchema,
    destinationType: z.literal("azure_event_grid"),
  }),
]);

export const tunnelsWebhookEndpointWithSecretSchema =
  tunnelsWebhookEndpointSchema.and(z.object({ signingSecret: z.string() }));

const createTunnelsWebhookBaseParamsSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().optional().nullable(),
  status: tunnelsWebhookEndpointStatusSchema.optional(),
  events: z.array(tunnelsWebhookEventTypeSchema).min(1),
});

export const createTunnelsWebhookParamsSchema =
  createTunnelsWebhookBaseParamsSchema.extend({
    config: tunnelsWebhookEndpointConfigSchema,
    destinationType: z
      .literal("webhook_endpoint")
      .optional()
      .default("webhook_endpoint"),
  });

export const updateTunnelsWebhookParamsSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().optional().nullable(),
  status: tunnelsWebhookEndpointStatusSchema.optional(),
  events: z.array(tunnelsWebhookEventTypeSchema).min(1).optional(),
  config: tunnelsWebhookEndpointConfigSchema.optional(),
});

export const listTunnelsWebhooksParamsSchema = z.object({
  q: z.string().trim().min(1).optional(),
  status: tunnelsWebhookEndpointStatusSchema.optional(),
  destinationType: tunnelsWebhookDestinationTypeSchema.optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  sort: z.enum(["name", "status", "createdAt", "updatedAt"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

export const listTunnelsWebhooksResponseSchema = z.object({
  webhooks: z.array(tunnelsWebhookEndpointSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

export const tunnelsWebhookDeliveryAttemptSchema = z.object({
  id: z.string(),
  deliveryId: z.string(),
  attemptNumber: z.number().int(),
  status: tunnelsWebhookDeliveryAttemptStatusSchema,
  httpStatus: z.number().int().nullable(),
  responseTimeMs: z.number().int().nullable(),
  responseHeaders: z.record(z.string(), z.array(z.string())).nullable(),
  responseBody: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export const tunnelsWebhookDeliverySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string(),
  webhookEndpointId: z.string(),
  eventId: z.string(),
  eventType: z.string(),
  status: tunnelsWebhookDeliveryStatusSchema,
  attemptCount: z.number().int(),
  nextAttemptAt: z.string().datetime().nullable(),
  lastAttemptAt: z.string().datetime().nullable(),
  succeededAt: z.string().datetime().nullable(),
  failedAt: z.string().datetime().nullable(),
  lastHttpStatus: z.number().int().nullable(),
  lastResponseTimeMs: z.number().int().nullable(),
  lastError: z.string().nullable(),
  requestBody: z.json(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  attempts: z.array(tunnelsWebhookDeliveryAttemptSchema).optional(),
});

export const listTunnelsWebhookDeliveriesParamsSchema = z.object({
  status: tunnelsWebhookDeliveryStatusSchema.optional(),
  eventType: z.string().trim().min(1).optional(),
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

export const listTunnelsWebhookDeliveriesResponseSchema = z.object({
  deliveries: z.array(tunnelsWebhookDeliverySchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

export type TunnelsWebhookEndpoint = z.infer<
  typeof tunnelsWebhookEndpointSchema
>;

export type TunnelsWebhookEndpointWithSecret = z.infer<
  typeof tunnelsWebhookEndpointWithSecretSchema
>;

export type TunnelsWebhookDestinationConfig = z.infer<
  typeof tunnelsWebhookDestinationConfigSchema
>;

export type CreateTunnelsWebhookParams = z.infer<
  typeof createTunnelsWebhookParamsSchema
>;

export type UpdateTunnelsWebhookParams = z.infer<
  typeof updateTunnelsWebhookParamsSchema
>;

export type ListTunnelsWebhooksParams = z.infer<
  typeof listTunnelsWebhooksParamsSchema
>;

export type ListTunnelsWebhooksResponse = z.infer<
  typeof listTunnelsWebhooksResponseSchema
>;

export type TunnelsWebhookDelivery = z.infer<
  typeof tunnelsWebhookDeliverySchema
>;

export type ListTunnelsWebhookDeliveriesParams = z.infer<
  typeof listTunnelsWebhookDeliveriesParamsSchema
>;

export type ListTunnelsWebhookDeliveriesResponse = z.infer<
  typeof listTunnelsWebhookDeliveriesResponseSchema
>;
