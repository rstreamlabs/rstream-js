// See LICENSE file in the project root for license information.

import * as z from "zod";

export const clientSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  status: z.enum(["online", "offline"]),
  details: z
    .object({
      agent: z.string().optional(),
      os: z.string().optional(),
      version: z.string().optional(),
      protocol_version: z.string().optional(),
    })
    .optional(),
  labels: z.record(z.string(), z.string().optional()).optional(),
});

export const listClientsParamsSchema = z.object({
  limit: z.number().optional(),
  filters: clientSchema
    .pick({
      labels: true,
    })
    .partial()
    .optional(),
});

export const listClientsResponseSchema = z.array(clientSchema);

export type Client = z.infer<typeof clientSchema>;

export type ListClientsParams = z.infer<typeof listClientsParamsSchema>;

export type ListClientsResponse = z.infer<typeof listClientsResponseSchema>;
