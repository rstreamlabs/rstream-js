// See LICENSE file in the project root for license information.

import { clientSchema } from "./client";
import { streamSummarySchema } from "./stream";
import { tunnelSchema } from "./tunnel";
import * as z from "zod";

const isoDateTimeSchema = z.string().datetime();

const initialStateSchema = z.object({
  snapshot_at: isoDateTimeSchema,
  clients: z.array(clientSchema),
  tunnels: z.array(tunnelSchema),
});

const eventBaseSchema = z.object({
  id: z.string().optional(),
  created_at: isoDateTimeSchema.optional(),
  user_id: z.string().optional(),
  workspace_id: z.string().optional(),
  project_id: z.string().optional(),
  cluster_id: z.string().optional(),
});

const withEventBase = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).merge(eventBaseSchema).passthrough();

const stateInitialEvent = withEventBase({
  type: z.literal("state.initial"),
  object: initialStateSchema,
});

const streamSummaryEvent = withEventBase({
  type: z.literal("stream.summary"),
  object: streamSummarySchema,
});

const commonEvents = [
  withEventBase({
    type: z.literal("client.created"),
    object: clientSchema,
  }),
  withEventBase({
    type: z.literal("client.updated"),
    object: clientSchema,
  }),
  withEventBase({
    type: z.literal("client.deleted"),
    object: clientSchema,
  }),
  withEventBase({
    type: z.literal("tunnel.created"),
    object: tunnelSchema,
  }),
  withEventBase({
    type: z.literal("tunnel.updated"),
    object: tunnelSchema,
  }),
  withEventBase({
    type: z.literal("tunnel.deleted"),
    object: tunnelSchema,
  }),
] as const;

export const wsEvents = z.union([stateInitialEvent, ...commonEvents]);

export const webhookEvents = z.union([...commonEvents, streamSummaryEvent]);

export const eventSchema = z.union([wsEvents, webhookEvents]);

export type InitialState = z.infer<typeof initialStateSchema>;

export type WsEvent = z.infer<typeof wsEvents>;

export type WebhookEvent = z.infer<typeof webhookEvents>;

export type Event = z.infer<typeof eventSchema>;
