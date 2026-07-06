// See LICENSE file in the project root for license information.

import { filters } from "./zod";
import { select } from "./zod";
import { tunnelSchema } from "./tunnel";
import * as z from "zod";
import type { JwtPayload } from "jsonwebtoken";

const nonEmptyStringSchema = z.string().trim().min(1);

export const authTokenPermissionsSchema = z.array(z.string());

export const authTokenTunnelsScopesSchema = z
  .object({
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
    tunnels: authTokenTunnelsScopesSchema.optional(),
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

const authTokenTunnelResourceLeafSchema = z
  .object({
    workspaces: z.array(nonEmptyStringSchema).min(1).optional(),
    projects: z.array(nonEmptyStringSchema).min(1).optional(),
    scopes: authTokenScopesSchema.optional(),
  })
  .strict()
  .superRefine((resource, ctx) => {
    if (resource.workspaces !== undefined && resource.projects !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A tunnel resource cannot target workspaces and projects at the same time.",
        path: ["projects"],
      });
    }
    if (
      resource.workspaces === undefined &&
      resource.projects === undefined &&
      resource.scopes === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A tunnel resource must target workspaces, target projects, or define scopes.",
        path: ["workspaces"],
      });
    }
  });

type AuthTokenTunnelResourceLeaf = z.infer<
  typeof authTokenTunnelResourceLeafSchema
>;

export type RstreamAuthTokenTunnelResourceLeaf = AuthTokenTunnelResourceLeaf;

export type RstreamAuthTokenTunnelResource =
  | AuthTokenTunnelResourceLeaf
  | { AND: RstreamAuthTokenTunnelResource[] }
  | { OR: RstreamAuthTokenTunnelResource[] };

export const authTokenTunnelResourceSchema: z.ZodType<RstreamAuthTokenTunnelResource> =
  z.lazy(() =>
    z.union([
      authTokenTunnelResourceLeafSchema,
      z.object({ AND: z.array(authTokenTunnelResourceSchema).min(1) }).strict(),
      z.object({ OR: z.array(authTokenTunnelResourceSchema).min(1) }).strict(),
    ]),
  );

export const authTokenResourcesSchema = z
  .object({
    tunnels: authTokenTunnelResourceSchema.optional(),
  })
  .strict()
  .superRefine((resources, ctx) => {
    if (resources.tunnels !== undefined) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Tunnel resources are required.",
      path: ["tunnels"],
    });
  });

const authTokenCommonSchema = {
  aud: z.union([z.string(), z.array(z.string())]).optional(),
  exp: z.number().optional(),
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
  resources: authTokenResourcesSchema.optional(),
  sub: z.string().optional(),
};

export const authTokenSchema = z.union([
  z
    .object({
      type: z.literal("auth"),
      userId: z.string(),
      permissions: authTokenPermissionsSchema.nullable(),
      sourceCredentialId: z.string().optional(),
      sourceCredentialUpdatedAt: z.string().datetime().optional(),
      ...authTokenCommonSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("pat"),
      tokendpoint: z.string().optional(),
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
    metadata: z.unknown().optional(),
    permissions: authTokenPermissionsSchema.nullable().optional(),
    resources: authTokenResourcesSchema.optional(),
  })
  .strict()
  .superRefine((params, ctx) => {
    if (params.resources?.tunnels !== undefined) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Explicit resources.tunnels is required.",
      path: ["resources", "tunnels"],
    });
  });

export const createAuthTokenResponseSchema = z.object({
  token: z.string(),
});

export type RstreamAuthTokenPermissions = z.infer<
  typeof authTokenPermissionsSchema
>;

export type RstreamAuthTokenTunnelScopes = z.infer<
  typeof authTokenTunnelsScopesSchema
>;

export type RstreamAuthTokenScopes = z.infer<typeof authTokenScopesSchema>;

export type RstreamAuthTokenResources = z.infer<
  typeof authTokenResourcesSchema
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

export type RstreamAuthJwtPayload = JwtPayload & RstreamAuthToken;
