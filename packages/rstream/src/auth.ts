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

export type TokenCredentials = z.infer<typeof tokenCredentialsSchema>;

export type ClientCredentials = z.infer<typeof clientCredentialsSchema>;

export type RstreamCredentials = z.infer<typeof credentialsSchema>;

export interface RstreamAppTokenClaims {
  clientId: string;
  exp: number;
  iat: number;
  type: "app";
}

export interface CreateClientCredentialsTokenOptions {
  claims?: Record<string, unknown>;
  expiresInSeconds?: number;
  issuedAt?: number;
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
  const iat =
    options.issuedAt !== undefined
      ? Math.floor(options.issuedAt)
      : Math.floor(Date.now() / 1000);
  const exp = iat + (options.expiresInSeconds ?? 60);
  const claims = {
    ...options.claims,
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
