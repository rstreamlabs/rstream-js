// See LICENSE file in the project root for license information.

import { tunnelSchema } from "@rstreamlabs/rstream/tunnel";
import * as z from "zod";
import type { Tunnel } from "@rstreamlabs/rstream/tunnel";

const DEFAULT_PUBLISHED_PORT = 443;

export const tunnelFilterSchema = tunnelSchema
  .pick({
    id: true,
    name: true,
    type: true,
    status: true,
    client_id: true,
    user_id: true,
    publish: true,
    protocol: true,
    hostname: true,
    http_version: true,
    labels: true,
  })
  .partial();

export const listTunnelsParamsSchema = z.object({
  limit: z.number().int().min(1).optional(),
  filters: tunnelFilterSchema.optional(),
});

export const listTunnelsResponseSchema = z.array(tunnelSchema);

export type TunnelFilter = z.infer<typeof tunnelFilterSchema>;

export function formatTunnelHost(
  tunnel: Pick<Tunnel, "host" | "hostname" | "port">,
): string | undefined {
  if (!tunnel.hostname) return tunnel.host;
  if (!tunnel.port || tunnel.port === DEFAULT_PUBLISHED_PORT) {
    return tunnel.hostname;
  }
  return `${tunnel.hostname}:${tunnel.port}`;
}

export type ListTunnelsParams = z.infer<typeof listTunnelsParamsSchema>;

export type ListTunnelsResponse = z.infer<typeof listTunnelsResponseSchema>;
