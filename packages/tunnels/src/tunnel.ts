// See LICENSE file in the project root for license information.

import * as z from "zod";

const DEFAULT_PUBLISHED_PORT = 443;

export const tunnelSchema = z.object({
  // common properties
  client_id: z.string(),
  user_id: z.string().optional(),
  workspace_id: z.string().optional(),
  project_id: z.string().optional(),
  cluster_id: z.string().optional(),
  plan: z.string().optional(),
  provider: z.string().optional(),
  region: z.string().optional(),
  status: z.enum(["online", "offline"]),
  // tunnel properties
  id: z.string(),
  creation_date: z.union([z.string().datetime(), z.date()]).optional(),
  name: z.string().optional(),
  type: z.enum(["bytestream", "datagram"]).optional(),
  publish: z.boolean().optional(),
  protocol: z.enum(["tls", "dtls", "quic", "http"]).optional(),
  labels: z.record(z.string(), z.string()).optional(),
  geo_ip: z.array(z.string()).optional(),
  trusted_ips: z.array(z.string()).optional(),
  host: z.string().optional(),
  hostname: z.string().optional(),
  port: z.number().int().min(1).max(65535).optional(),
  tls_mode: z.enum(["passthrough", "terminated"]).optional(),
  tls_alpns: z.array(z.string()).optional(),
  tls_min_version: z.string().optional(),
  tls_ciphers: z.array(z.string()).optional(),
  mtls: z.boolean().optional(),
  mtls_ca_cert_pem: z.string().optional(),
  http_version: z.enum(["http/1.1", "h2", "h2c", "h3"]).optional(),
  http_use_tls: z.boolean().optional(),
  upstream_tls: z.boolean().optional(),
  token_auth: z.boolean().optional(),
  rstream_auth: z.boolean().optional(),
  challenge_mode: z.boolean().optional(),
});

export const listTunnelsParamsSchema = z.object({
  limit: z.number().optional(),
  filters: tunnelSchema
    .pick({
      status: true,
      client_id: true,
      hostname: true,
      protocol: true,
      publish: true,
      labels: true,
    })
    .partial()
    .optional(),
});

export const listTunnelsResponseSchema = z.array(tunnelSchema);

export type Tunnel = z.infer<typeof tunnelSchema>;

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
