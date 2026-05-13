// See LICENSE file in the project root for license information.

import crypto from "crypto";
import jwt from "jsonwebtoken";
import * as z from "zod";

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

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

type Logical<T> = T | { AND: Logical<T>[] } | { OR: Logical<T>[] };

function logical<T extends z.ZodType>(
  leaf: T,
): z.ZodType<Logical<z.output<T>>> {
  type Node = Logical<z.output<T>>;
  const node: z.ZodType<Node> = z.lazy(
    (): z.ZodType<Node> =>
      z.union([
        leaf,
        z.object({ AND: z.array(node).min(1) }).strict(),
        z.object({ OR: z.array(node).min(1) }).strict(),
      ]),
  );
  return node;
}

const appTokenTunnelCreateScopeSchema = z.union([
  z.boolean(),
  z
    .object({
      filters: jsonObjectSchema.optional(),
    })
    .strict(),
]);

const appTokenTunnelConnectScopeSchema = z.union([
  z.boolean(),
  z
    .object({
      filters: jsonObjectSchema.optional(),
      params: jsonObjectSchema.optional(),
    })
    .strict(),
]);

const appTokenTunnelListScopeSchema = z.union([
  z.boolean(),
  z
    .object({
      filters: jsonObjectSchema.optional(),
      select: jsonObjectSchema.optional(),
    })
    .strict(),
]);

const appTokenTunnelScopesSchema = z
  .object({
    create: appTokenTunnelCreateScopeSchema.optional(),
    connect: appTokenTunnelConnectScopeSchema.optional(),
    list: appTokenTunnelListScopeSchema.optional(),
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

const appTokenScopesSchema = z
  .object({
    tunnels: appTokenTunnelScopesSchema.optional(),
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

const appTokenTunnelGrantLeafSchema = z
  .object({
    workspaces: z.array(nonEmptyStringSchema).min(1).optional(),
    projects: z.array(nonEmptyStringSchema).min(1).optional(),
    scopes: appTokenScopesSchema.optional(),
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
    if (
      grant.workspaces === undefined &&
      grant.projects === undefined &&
      grant.scopes === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A tunnel grant must target workspaces, target projects, or define scopes.",
      });
    }
  });

const appTokenTunnelGrantSchema = logical(appTokenTunnelGrantLeafSchema);

export type RstreamAppTokenTunnelGrant = z.infer<
  typeof appTokenTunnelGrantSchema
>;

function tunnelGrantBranches(
  grant: RstreamAppTokenTunnelGrant,
): Array<{ targets: number; scopes: number }> {
  if ("OR" in grant) {
    return grant.OR.flatMap((child) => tunnelGrantBranches(child));
  }
  if ("AND" in grant) {
    return grant.AND.reduce<Array<{ targets: number; scopes: number }>>(
      (branches, child) =>
        branches.flatMap((branch) =>
          tunnelGrantBranches(child).map((childBranch) => ({
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
        grant.projects !== undefined || grant.workspaces !== undefined ? 1 : 0,
      scopes: grant.scopes?.tunnels !== undefined ? 1 : 0,
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
    tunnelsGrants: appTokenTunnelGrantSchema.optional(),
  })
  .strict()
  .superRefine((claims, ctx) => {
    if (claims.tunnelsGrants === undefined) return;
    const branches = tunnelGrantBranches(claims.tunnelsGrants);
    if (branches.some((branch) => branch.scopes === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Tunnel grants must include explicit scopes.",
        path: ["tunnelsGrants"],
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
  tunnelsGrants?: RstreamAppTokenTunnelGrant;
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
