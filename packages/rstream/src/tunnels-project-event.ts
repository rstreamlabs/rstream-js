// See LICENSE file in the project root for license information.

import * as z from "zod";

export const tunnelsProjectEventTimelineSchema = z.enum([
  "30m",
  "1h",
  "12h",
  "24h",
  "3d",
  "1w",
  "30d",
]);

export const tunnelsProjectEventCategorySchema = z.enum([
  "lifecycle",
  "stream_log",
]);

export const tunnelsProjectEventSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  eventType: z.string(),
  eventCategory: tunnelsProjectEventCategorySchema,
  projectId: z.string(),
  workspaceId: z.string(),
  clusterId: z.string(),
  userId: z.string().optional(),
  payload: z.json().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
});

export const listTunnelsProjectEventsParamsSchema = z.object({
  timeline: tunnelsProjectEventTimelineSchema.optional(),
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
  eventType: z.string().trim().min(1).optional(),
  afterEventId: z.string().trim().min(1).optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

export const listTunnelsProjectEventsResponseSchema = z.object({
  events: z.array(tunnelsProjectEventSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

export type TunnelsProjectEvent = z.infer<typeof tunnelsProjectEventSchema>;

export type ListTunnelsProjectEventsParams = z.infer<
  typeof listTunnelsProjectEventsParamsSchema
>;

export type ListTunnelsProjectEventsResponse = z.infer<
  typeof listTunnelsProjectEventsResponseSchema
>;
