// See LICENSE file in the project root for license information.

import { filters, select } from "./zod";
import { tunnelSchema } from "./tunnel";
import * as z from "zod";
import type { JwtPayload } from "jsonwebtoken";

export const authTokenPermissionsSchema = z.array(z.string());

export const authTokenTunnelsScopesSchema = z.object({
  // Scopes for creating tunnels
  create: z
    .union([
      z.boolean(),
      z.object({
        filters: filters(
          tunnelSchema.omit({
            client_id: true,
            user_id: true,
            workspace_id: true,
            project_id: true,
            cluster_id: true,
            plan: true,
            provider: true,
            region: true,
            status: true,
            id: true,
            creation_date: true,
          }),
        ).optional(),
      }),
    ])
    .optional(),
  // Scopes for connecting to tunnels
  connect: z
    .union([
      z.boolean(),
      z.object({
        filters: filters(tunnelSchema).optional(),
        params: filters(
          z.object({
            path: z.string().optional(),
          }),
        ).optional(),
      }),
    ])
    .optional(),
  // Scopes for listing tunnels
  list: z
    .union([
      z.boolean(),
      z.object({
        filters: filters(tunnelSchema).optional(),
        select: select(tunnelSchema).optional(),
      }),
    ])
    .optional(),
});

export const authTokenScopesSchema = z.object({
  tunnels: authTokenTunnelsScopesSchema.optional(), // Scopes related to tunnels
});

export const authTokenSchema = z
  .union([
    z.object({
      type: z.literal("auth"),
      userId: z.string(),
      permissions: authTokenPermissionsSchema.nullable(),
    }),
    z.object({
      type: z.literal("pat"),
      token_endpoint: z.string().optional(),
    }),
    z.object({
      type: z.literal("app"),
      clientId: z.string(),
      permissions: authTokenPermissionsSchema.nullable(),
    }),
  ])
  .and(
    z.object({
      workspace_id: z.string().optional(),
      project_id: z.string().optional(),
      metadata: z
        .object({
          engine: z.string().optional(),
          scopes: authTokenScopesSchema.optional(),
        })
        .optional(),
    }),
  );

export const tokenSchema = authTokenSchema;

export const createAuthTokenParamsSchema = z.object({
  expires_in: z.number().default(60), // 1 minute
  workspace_id: z.string().optional(),
  project_id: z.string().optional(),
  scopes: authTokenScopesSchema.optional(),
  metadata: z.unknown().optional(), // Additional metadata
});

export const createAuthTokenResponseSchema = z.object({
  token: z.string(),
});

export type RstreamAuthTokenPermissions = z.infer<
  typeof authTokenPermissionsSchema
>;

export type RstreamAuthTokenScopes = z.infer<
  typeof authTokenTunnelsScopesSchema
>;

export type RstreamAuthToken = z.infer<typeof authTokenSchema>;

export type Token = z.infer<typeof tokenSchema>;

export type CreateAuthTokenParams = z.infer<typeof createAuthTokenParamsSchema>;

export type CreateAuthTokenResponse = z.infer<
  typeof createAuthTokenResponseSchema
>;

export type RstreamAuth = (() => Promise<string>) | string;

export type RstreamAuthJwtPayload = JwtPayload & RstreamAuthToken;
