// See LICENSE file in the project root for license information.

import { authTokenResourcesSchema } from "./auth-token";
import * as z from "zod";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import type { RstreamAuthTokenResources } from "./auth-token";
import type { RstreamAuthTokenTunnelResource } from "./auth-token";

export * from "./auth-token";

const nonEmptyStringSchema = z.string().trim().min(1);

export const tokenCredentialsSchema = z.object({
  token: nonEmptyStringSchema,
});

export const clientCredentialsSchema = z.object({
  clientId: nonEmptyStringSchema,
  clientSecret: nonEmptyStringSchema,
});

export const credentialsSchema = z.union([
  tokenCredentialsSchema,
  clientCredentialsSchema,
]);

export type RstreamAppTokenTunnelResource = RstreamAuthTokenTunnelResource;

function tunnelResourceBranches(
  resource: RstreamAppTokenTunnelResource,
): Array<{ targets: number; scopes: number }> {
  if ("OR" in resource) {
    return resource.OR.flatMap((child) => tunnelResourceBranches(child));
  }
  if ("AND" in resource) {
    return resource.AND.reduce<Array<{ targets: number; scopes: number }>>(
      (branches, child) =>
        branches.flatMap((branch) =>
          tunnelResourceBranches(child).map((childBranch) => ({
            targets: branch.targets + childBranch.targets,
            scopes: branch.scopes + childBranch.scopes,
          })),
        ),
      [{ targets: 0, scopes: 0 }],
    );
  }
  return [
    {
      targets:
        resource.projects !== undefined || resource.workspaces !== undefined
          ? 1
          : 0,
      scopes: resource.scopes?.tunnels !== undefined ? 1 : 0,
    },
  ];
}

const appTokenAdditionalClaimsSchema = z
  .object({
    metadata: z
      .object({
        engine: z.string().optional(),
      })
      .strict()
      .optional(),
    permissions: z.array(nonEmptyStringSchema).nullable().optional(),
    resources: authTokenResourcesSchema.optional(),
  })
  .strict()
  .superRefine((claims, ctx) => {
    if (claims.resources?.tunnels === undefined) return;
    const branches = tunnelResourceBranches(claims.resources.tunnels);
    if (branches.some((branch) => branch.scopes === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Tunnel resources must include explicit scopes.",
        path: ["resources", "tunnels"],
      });
    }
  });

export type TokenCredentials = z.infer<typeof tokenCredentialsSchema>;

export type ClientCredentials = z.infer<typeof clientCredentialsSchema>;

export type RstreamCredentials = z.infer<typeof credentialsSchema>;

export interface RstreamAppTokenClaims {
  clientId: string;
  exp: number;
  iat: number;
  metadata?: {
    engine?: string;
  };
  permissions?: string[] | null;
  resources?: RstreamAuthTokenResources;
  type: "app";
}

export type RstreamAppTokenAdditionalClaims = Omit<
  RstreamAppTokenClaims,
  "clientId" | "exp" | "iat" | "type"
>;

export interface CreateClientCredentialsTokenOptions {
  claims?: RstreamAppTokenAdditionalClaims;
  expiresInSeconds?: number;
  issuedAt?: number;
}

const issuedAtSkewSeconds = 300;

function normalizeIssuedAt(value?: number): number {
  const now = Math.floor(Date.now() / 1000);
  if (value === undefined) {
    return now;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("issuedAt must be a safe integer Unix timestamp.");
  }
  if (Math.abs(value - now) > issuedAtSkewSeconds) {
    throw new Error("issuedAt must be close to the current time.");
  }
  return value;
}

function normalizeExpiresInSeconds(value?: number): number {
  const ttl = value ?? 60;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 3600) {
    throw new Error("expiresInSeconds must be an integer between 1 and 3600.");
  }
  return ttl;
}

export function isTokenCredentials(
  credentials?: RstreamCredentials,
): credentials is TokenCredentials {
  return credentials !== undefined && "token" in credentials;
}

export function isClientCredentials(
  credentials?: RstreamCredentials,
): credentials is ClientCredentials {
  return credentials !== undefined && "clientId" in credentials;
}

export function createClientCredentialsToken(
  credentials: ClientCredentials,
  options: CreateClientCredentialsTokenOptions = {},
): { token: string } {
  const iat = normalizeIssuedAt(options.issuedAt);
  const exp = iat + normalizeExpiresInSeconds(options.expiresInSeconds);
  const additionalClaims = appTokenAdditionalClaimsSchema.parse(
    options.claims ?? {},
  );
  const claims: RstreamAppTokenClaims = {
    ...additionalClaims,
    clientId: credentials.clientId,
    exp,
    iat,
    type: "app",
  };
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(credentials.clientSecret, "hex"),
    format: "der",
    type: "pkcs8",
  });
  const token = jwt.sign(claims, privateKey, {
    algorithm: "ES512",
  });
  return { token };
}
