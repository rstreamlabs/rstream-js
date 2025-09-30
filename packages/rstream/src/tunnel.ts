// See LICENSE file in the project root for license information.

import * as z from "zod";

export const tunnelSchema = z.object({
  // common properties
  client_id: z.string(),
  user_id: z.string(),
  status: z.enum(["online", "offline"]),
  // tunnel properties
  id: z.string(),
  name: z.string().optional(),
  creation_date: z.date().optional(),
  type: z.enum(["bytestream", "datagram"]).optional(),
  publish: z.boolean().optional(),
  protocol: z.enum(["tls", "dtls", "quic", "http"]).optional(),
  labels: z.record(z.string(), z.string().optional()).optional(),
  geo_ip: z.array(z.string()).optional(),
  trusted_ips: z.array(z.string()).optional(),
  host: z.string().optional(),
  tls_mode: z.enum(["passthrough", "terminated"]).optional(),
  tls_alpns: z.array(z.string()).optional(),
  tls_min_version: z.string().optional(),
  tls_ciphers: z.array(z.string()).optional(),
  mtls: z.boolean().optional(),
  mtls_ca_cert_pem: z.string().optional(),
  http_version: z.enum(["http/1.1", "h2c", "h3"]).optional(),
  http_use_tls: z.boolean().optional(),
  token_auth: z.boolean().optional(),
  sso: z.boolean().optional(),
  sso_providers: z.array(z.string()).optional(),
  email_whitelist: z.array(z.string()).optional(),
  email_blacklist: z.array(z.string()).optional(),
  challenge: z.boolean().optional(),
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

export const listTunnelsResponseSchema = z.array(tunnelSchema);

export type Tunnel = z.infer<typeof tunnelSchema>;

export type ListTunnelsParams = z.infer<typeof listTunnelsParamsSchema>;

export type ListTunnelsResponse = z.infer<typeof listTunnelsResponseSchema>;
