// See LICENSE file in the project root for license information.

import { filters, select } from "./zod";
import { tunnelSchema } from "./tunnel";
import * as z from "zod";
import type { JwtPayload } from "jsonwebtoken";

const nonEmptyStringSchema = z.string().trim().min(1);

export const authTokenPermissionsSchema = z.array(z.string());

export const authTokenTunnelsScopesSchema = z
  .object({
    // Scopes for creating tunnels
    create: z
      .union([
        z.boolean(),
        z
          .object({
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
          })
          .strict(),
      ])
      .optional(),
    // Scopes for connecting to tunnels
    connect: z
      .union([
        z.boolean(),
        z
          .object({
            filters: filters(tunnelSchema).optional(),
            params: filters(
              z.object({
                path: z.string().optional(),
              }),
            ).optional(),
          })
          .strict(),
      ])
      .optional(),
    // Scopes for listing tunnels
    list: z
      .union([
        z.boolean(),
        z
          .object({
            filters: filters(tunnelSchema).optional(),
            select: select(tunnelSchema).optional(),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict()
  .superRefine((scopes, ctx) => {
    if (
      scopes.create === undefined &&
      scopes.connect === undefined &&
      scopes.list === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one tunnel scope action is required.",
      });
    }
  });

export const authTokenScopesSchema = z
  .object({
    tunnels: authTokenTunnelsScopesSchema.optional(), // Scopes related to tunnels
  })
  .strict()
  .superRefine((scopes, ctx) => {
    if (scopes.tunnels === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Tunnel scopes are required.",
        path: ["tunnels"],
      });
    }
  });

export const authTokenTunnelGrantSchema = z
  .object({
    workspaces: z.array(nonEmptyStringSchema).min(1).optional(),
    projects: z.array(nonEmptyStringSchema).min(1).optional(),
    scopes: authTokenScopesSchema,
  })
  .strict()
  .superRefine((grant, ctx) => {
    if (grant.workspaces !== undefined && grant.projects !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A grant cannot target workspaces and projects at the same time.",
        path: ["projects"],
      });
    }
    if (grant.workspaces === undefined && grant.projects === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A grant must target workspaces or projects.",
        path: ["workspaces"],
      });
    }
  });

const authTokenCommonSchema = {
  aud: z.union([z.string(), z.array(z.string())]).optional(),
  exp: z.number().optional(),
  tunnelsGrants: z.array(authTokenTunnelGrantSchema).optional(),
  iat: z.number().optional(),
  iss: z.string().optional(),
  jti: z.string().optional(),
  metadata: z
    .object({
      engine: z.string().optional(),
    })
    .strict()
    .optional(),
  nbf: z.number().optional(),
  sub: z.string().optional(),
};

export const authTokenSchema = z.union([
  z
    .object({
      type: z.literal("auth"),
      userId: z.string(),
      permissions: authTokenPermissionsSchema.nullable(),
      ...authTokenCommonSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("pat"),
      token_endpoint: z.string().optional(),
      ...authTokenCommonSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("app"),
      clientId: z.string(),
      permissions: authTokenPermissionsSchema.nullable(),
      ...authTokenCommonSchema,
    })
    .strict(),
]);

export const tokenSchema = authTokenSchema;

export const createAuthTokenParamsSchema = z
  .object({
    expires_in: z.number().int().min(1).max(3600).default(60),
    scopes: authTokenScopesSchema.optional(),
    tunnelsGrants: z.array(authTokenTunnelGrantSchema).min(1).optional(),
    metadata: z.unknown().optional(), // Additional metadata
  })
  .strict()
  .superRefine((params, ctx) => {
    if (params.scopes !== undefined && params.tunnelsGrants !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use either scopes or tunnelsGrants, not both.",
        path: ["tunnelsGrants"],
      });
    }
    if (params.scopes === undefined && params.tunnelsGrants === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Explicit scopes or tunnelsGrants are required.",
        path: ["scopes"],
      });
    }
  });

export const createAuthTokenResponseSchema = z.object({
  token: z.string(),
});

export type RstreamAuthTokenPermissions = z.infer<
  typeof authTokenPermissionsSchema
>;

export type RstreamAuthTokenTunnelGrant = z.infer<
  typeof authTokenTunnelGrantSchema
>;

export type RstreamAuthTokenScopes = z.infer<
  typeof authTokenTunnelsScopesSchema
>;

export type RstreamAuthToken = z.infer<typeof authTokenSchema>;

export type Token = z.infer<typeof tokenSchema>;

export type CreateAuthTokenParams = z.input<typeof createAuthTokenParamsSchema>;

export type ParsedCreateAuthTokenParams = z.infer<
  typeof createAuthTokenParamsSchema
>;

export type CreateAuthTokenResponse = z.infer<
  typeof createAuthTokenResponseSchema
>;

export type RstreamAuth = (() => Promise<string>) | string;

export type RstreamAuthJwtPayload = JwtPayload & RstreamAuthToken;
