// See LICENSE file in the project root for license information.

import * as z from "zod";

export const clientSchema = z.object({
  id: z.string(),
  status: z.enum(["online", "offline"]),
  user_id: z.string().optional(),
  workspace_id: z.string().optional(),
  project_id: z.string().optional(),
  cluster_id: z.string().optional(),
  plan: z.string().optional(),
  provider: z.string().optional(),
  region: z.string().optional(),
  agent: z.string().optional(),
  channel: z.string().optional(),
  version: z.string().optional(),
  os: z.string().optional(),
  arch: z.string().optional(),
  protocol_version: z.string().optional(),
  labels: z.record(z.string(), z.string()).optional(),
});

export const clientFilterSchema = clientSchema
  .pick({
    id: true,
    status: true,
    user_id: true,
    agent: true,
    channel: true,
    version: true,
    os: true,
    arch: true,
    protocol_version: true,
    labels: true,
  })
  .partial();

export const listClientsParamsSchema = z.object({
  limit: z.number().int().min(1).optional(),
  filters: clientFilterSchema.optional(),
});

export const listClientsResponseSchema = z.array(clientSchema);

export type Client = z.infer<typeof clientSchema>;

export type ClientFilter = z.infer<typeof clientFilterSchema>;

export type ListClientsParams = z.infer<typeof listClientsParamsSchema>;

export type ListClientsResponse = z.infer<typeof listClientsResponseSchema>;
