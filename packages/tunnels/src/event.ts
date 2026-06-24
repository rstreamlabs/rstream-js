// See LICENSE file in the project root for license information.

import { clientSchema } from "./client";
import { streamSummarySchema } from "./stream";
import { webTTYControlRequestSchema } from "./webtty-resource";
import { webTTYParticipantSchema } from "./webtty-resource";
import { webTTYSessionGroupSchema } from "./webtty-resource";
import { webTTYSessionSchema } from "./webtty-resource";
import { tunnelSchema } from "@rstreamlabs/rstream/tunnel";
import * as z from "zod";

const isoDateTimeSchema = z.string().datetime({ offset: true });

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

const stateInitialEventSchema = withEventBase({
  type: z.literal("state.initial"),
  object: initialStateSchema,
});

export const streamSummaryEventSchema = withEventBase({
  type: z.literal("stream.summary"),
  object: streamSummarySchema,
});

const commonEventsSchema = [
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

const webTTYEventsSchema = [
  withEventBase({
    type: z.literal("webtty.session.created"),
    object: webTTYSessionSchema,
  }),
  withEventBase({
    type: z.literal("webtty.session.updated"),
    object: z.union([webTTYSessionSchema, webTTYSessionGroupSchema]),
  }),
  withEventBase({
    type: z.literal("webtty.session.ended"),
    object: webTTYSessionSchema,
  }),
  withEventBase({
    type: z.literal("webtty.participant.joined"),
    object: webTTYParticipantSchema,
  }),
  withEventBase({
    type: z.literal("webtty.participant.updated"),
    object: webTTYParticipantSchema,
  }),
  withEventBase({
    type: z.literal("webtty.participant.left"),
    object: webTTYParticipantSchema,
  }),
  withEventBase({
    type: z.literal("webtty.control.requested"),
    object: webTTYControlRequestSchema,
  }),
  withEventBase({
    type: z.literal("webtty.control.granted"),
    object: webTTYControlRequestSchema,
  }),
  withEventBase({
    type: z.literal("webtty.control.refused"),
    object: webTTYControlRequestSchema,
  }),
  withEventBase({
    type: z.literal("webtty.control.revoked"),
    object: webTTYControlRequestSchema,
  }),
] as const;

const webhookDeliverableEventsSchema = [
  commonEventsSchema[0],
  commonEventsSchema[2],
  commonEventsSchema[3],
  commonEventsSchema[5],
  ...webTTYEventsSchema,
] as const;

export const wsEventsSchema = z.union([
  stateInitialEventSchema,
  ...commonEventsSchema,
  ...webTTYEventsSchema,
]);

export const webhookEventsSchema = z.union(webhookDeliverableEventsSchema);

export const projectLogEventsSchema = streamSummaryEventSchema;

export const eventSchema = z.union([
  wsEventsSchema,
  webhookEventsSchema,
  projectLogEventsSchema,
]);

export type InitialState = z.infer<typeof initialStateSchema>;

export type WsEvent = z.infer<typeof wsEventsSchema>;

export type WebhookEvent = z.infer<typeof webhookEventsSchema>;

export type ProjectLogEvent = z.infer<typeof projectLogEventsSchema>;

export type Event = z.infer<typeof eventSchema>;
