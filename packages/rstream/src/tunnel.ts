// See LICENSE file in the project root for license information.

import * as z from "zod";

export const tunnelSchema = z.object({
  id: z.string(),
  client_id: z.string(),
  user_id: z.string(),
  status: z.enum(["online", "offline"]),
  name: z.string().optional(),
  protocol: z.string(),
  publish: z.boolean(),
  labels: z.record(z.string().optional()).optional(),
  host: z.string().optional(),
  tls_mode: z.string(),
  tls_min_version: z.string().optional(),
  mtls: z.boolean(),
  token_auth: z.boolean(),
  path: z.string().optional(),
});

export const listTunnelsParamsSchema = z.object({
  limit: z.number().optional(),
  filters: tunnelSchema
    .pick({
      status: true,
      client_id: true,
      protocol: true,
      publish: true,
      labels: true,
    })
    .partial()
    .optional(),
});

export const listTunnelsResponseSchema = z.object({
  tunnels: z.array(tunnelSchema),
});

export type Tunnel = z.infer<typeof tunnelSchema>;

export type ListTunnelsParams = z.infer<typeof listTunnelsParamsSchema>;

export type ListTunnelsResponse = z.infer<typeof listTunnelsResponseSchema>;
