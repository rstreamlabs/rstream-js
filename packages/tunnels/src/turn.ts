// See LICENSE file in the project root for license information.

import { isClientCredentials } from "@rstreamlabs/rstream";
import { isTokenCredentials } from "@rstreamlabs/rstream";
import { RstreamClient } from "@rstreamlabs/rstream";
import { turnCredentialsSchema } from "@rstreamlabs/rstream";
import * as z from "zod";
import crypto from "crypto";
import type { RstreamCredentials } from "@rstreamlabs/rstream";
import type { TURNCredentials } from "@rstreamlabs/rstream";

const defaultTURNPort = 3478;
const defaultTURNSPort = 5349;
const defaultTURNCredentialTTLSeconds = 10 * 60;
const maxTURNCredentialTTLSeconds = 60 * 60;

const turnTokenClaimsSchema = z.object({
  exp: z.number().int().optional(),
  iat: z.number().int().optional(),
  token_endpoint: z
    .string()
    .regex(/^[0-9a-f]{8}$/i)
    .optional(),
  type: z.enum(["app", "auth", "pat"]),
});

export const turnCredentialModeSchema = z.enum(["api", "app", "pat"]);

export type TURNCredentialMode = z.infer<typeof turnCredentialModeSchema>;

export interface CreateAPITURNCredentialsOptions {
  apiUrl?: string;
  credentials: RstreamCredentials;
  projectEndpoint?: string;
  projectId?: string;
}

export interface CreatePATTURNCredentialsOptions {
  clusterDomain: string;
  now?: Date | number;
  projectEndpoint: string;
  token: string;
  tokenEndpoint: string;
  ttlSeconds?: number;
  turnPort?: number;
  turnsPort?: number;
}

export interface CreateAPPTURNCredentialsOptions {
  apiUrl?: string;
  clientId: string;
  clientSecret: string;
  clusterDomain: string;
  keyringBaseUrl?: string;
  now?: Date | number;
  projectEndpoint: string;
  serverPublicKeyHex?: string;
  ttlSeconds?: number;
  turnPort?: number;
  turnsPort?: number;
}

export interface CreateTURNCredentialsOptions {
  apiUrl?: string;
  clusterDomain?: string;
  controlPlaneCredentials?: RstreamCredentials;
  credentials?: RstreamCredentials;
  engine?: string;
  keyringBaseUrl?: string;
  mode?: TURNCredentialMode;
  now?: Date | number;
  projectEndpoint?: string;
  projectId?: string;
  serverPublicKeyHex?: string;
  tokenEndpoint?: string;
  ttlSeconds?: number;
  turnPort?: number;
  turnsPort?: number;
}

function normalizeOptionalString(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeClusterDomain(clusterDomain?: string): string | undefined {
  const normalized = normalizeOptionalString(clusterDomain);
  return normalized?.toLowerCase();
}

function normalizeNow(now?: Date | number): number {
  if (now === undefined) {
    return Math.floor(Date.now() / 1000);
  }
  const timestamp = now instanceof Date ? now.getTime() / 1000 : now;
  if (!Number.isFinite(timestamp)) {
    throw new Error("TURN timestamp must be finite.");
  }
  return Math.floor(timestamp);
}

function normalizeTTLSeconds(ttlSeconds?: number): number {
  const ttl = ttlSeconds ?? defaultTURNCredentialTTLSeconds;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > maxTURNCredentialTTLSeconds) {
    throw new Error("TURN TTL must be an integer between 1 and 3600 seconds.");
  }
  return ttl;
}

function normalizePort(
  port: number | undefined,
  fallback: number,
  name: string,
) {
  const normalized = port ?? fallback;
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return normalized;
}

function normalizeTURNPort(port?: number): number {
  return normalizePort(port, defaultTURNPort, "TURN port");
}

function normalizeTURNSPort(port?: number): number {
  return normalizePort(port, defaultTURNSPort, "TURNS port");
}

function createTURNURLs(
  clusterDomain: string,
  turnPort?: number,
  turnsPort?: number,
): string[] {
  const normalizedTURNPort = normalizeTURNPort(turnPort);
  const normalizedTURNSPort = normalizeTURNSPort(turnsPort);
  return [
    `turn:${clusterDomain}:${normalizedTURNPort}?transport=udp`,
    `turn:${clusterDomain}:${normalizedTURNPort}?transport=tcp`,
    `turns:${clusterDomain}:${normalizedTURNSPort}?transport=udp`,
    `turns:${clusterDomain}:${normalizedTURNSPort}?transport=tcp`,
  ];
}

function parseTURNTokenClaims(token: string) {
  const parts = token.split(".");
  const payloadPart = parts.at(1);
  if (!payloadPart) {
    throw new Error("Invalid token format.");
  }
  let decoded: unknown;
  try {
    const payload = Buffer.from(payloadPart, "base64url").toString("utf8");
    decoded = JSON.parse(payload);
  } catch {
    throw new Error("Invalid token format.");
  }
  const parsed = turnTokenClaimsSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error("Invalid token format.");
  }
  return parsed.data;
}

function requirePATExpiration(
  claims: z.infer<typeof turnTokenClaimsSchema>,
  now: number,
): number {
  const exp = claims.exp;
  if (typeof exp !== "number") {
    throw new Error("TURN PAT mode requires a PAT token with expiration.");
  }
  if (exp <= now) {
    throw new Error("TURN PAT mode requires a non-expired PAT token.");
  }
  return exp;
}

function deriveClusterDomainFromEngine(
  projectEndpoint: string,
  engine: string,
): string {
  const normalizedProjectEndpoint = normalizeOptionalString(projectEndpoint);
  const normalizedEngine = normalizeOptionalString(engine);
  if (!normalizedProjectEndpoint || !normalizedEngine) {
    throw new Error(
      "Failed to derive the cluster domain from the engine address.",
    );
  }
  const url = new URL(`https://${normalizedEngine}`);
  const prefix = `${normalizedProjectEndpoint}.`;
  if (!url.hostname.startsWith(prefix)) {
    throw new Error(
      "Failed to derive the cluster domain from the engine address.",
    );
  }
  const clusterDomain = url.hostname.slice(prefix.length);
  if (!clusterDomain) {
    throw new Error(
      "Failed to derive the cluster domain from the engine address.",
    );
  }
  return clusterDomain;
}

function requireOption(value: string | undefined, message: string): string {
  if (value) {
    return value;
  }
  throw new Error(message);
}

function resolveMode(
  credentials?: RstreamCredentials,
  mode?: TURNCredentialMode,
): TURNCredentialMode {
  if (mode !== undefined) {
    return turnCredentialModeSchema.parse(mode);
  }
  if (isClientCredentials(credentials)) {
    return "app";
  }
  return "api";
}

async function loadTURNServerPublicKeyHex(
  clusterDomain: string,
  options: { apiUrl?: string; keyringBaseUrl?: string },
): Promise<string> {
  const configuredKey = normalizeOptionalString(options.keyringBaseUrl);
  const keyringBaseURL =
    configuredKey ??
    normalizeOptionalString(options.apiUrl) ??
    "https://rstream.io";
  const url = new URL(
    `/keyrings/turn/${clusterDomain}.spki.der.hex`,
    keyringBaseURL,
  );
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load TURN keyring.");
  }
  return (await response.text()).trim();
}

export async function createAPITURNCredentials(
  options: CreateAPITURNCredentialsOptions,
): Promise<TURNCredentials> {
  const projectId = normalizeOptionalString(options.projectId);
  const projectEndpoint = normalizeOptionalString(options.projectEndpoint);
  if (!projectId && !projectEndpoint) {
    throw new Error(
      "Project ID or project endpoint is required for TURN API mode.",
    );
  }
  const client = new RstreamClient({
    apiUrl: options.apiUrl,
    credentials: options.credentials,
  });
  if (projectId) {
    return await client.tunnels.projects.createTurnCredentials(projectId);
  }
  if (!projectEndpoint) {
    throw new Error(
      "Project ID or project endpoint is required for TURN API mode.",
    );
  }
  return await client.tunnels.projects.createTurnCredentialsByEndpoint(
    projectEndpoint,
  );
}

export function createPATTURNCredentials(
  options: CreatePATTURNCredentialsOptions,
): TURNCredentials {
  const clusterDomain = normalizeClusterDomain(options.clusterDomain);
  if (!clusterDomain) {
    throw new Error("Cluster domain is required for TURN PAT mode.");
  }
  const projectEndpoint = normalizeOptionalString(options.projectEndpoint);
  if (!projectEndpoint) {
    throw new Error("Project endpoint is required for TURN PAT mode.");
  }
  const token = normalizeOptionalString(options.token);
  if (!token) {
    throw new Error("Token is required for TURN PAT mode.");
  }
  const claims = parseTURNTokenClaims(token);
  if (claims.type !== "pat") {
    throw new Error("TURN PAT mode requires a PAT token.");
  }
  const tokenEndpoint = normalizeOptionalString(options.tokenEndpoint);
  if (!tokenEndpoint) {
    throw new Error("Token endpoint is required for TURN PAT mode.");
  }
  if (
    claims.token_endpoint !== undefined &&
    claims.token_endpoint !== tokenEndpoint
  ) {
    throw new Error("Token endpoint does not match the PAT token.");
  }
  const now = normalizeNow(options.now);
  const ttlSeconds = normalizeTTLSeconds(options.ttlSeconds);
  const exp = Math.min(now + ttlSeconds, requirePATExpiration(claims, now));
  const ttl = exp - now;
  const username = `v1:${exp}:pat:${projectEndpoint}:${tokenEndpoint}`;
  const tokenHash = crypto.createHash("sha256").update(token, "utf8").digest();
  const key = Buffer.from(
    crypto.hkdfSync(
      "sha256",
      tokenHash,
      Buffer.from(clusterDomain, "utf8"),
      Buffer.from("turn-pat-v1", "utf8"),
      32,
    ),
  );
  const credential = crypto
    .createHmac("sha256", key)
    .update(username, "utf8")
    .digest("base64");
  return turnCredentialsSchema.parse({
    credential,
    ttl,
    urls: createTURNURLs(clusterDomain, options.turnPort, options.turnsPort),
    username,
  });
}

export async function createAPPTURNCredentials(
  options: CreateAPPTURNCredentialsOptions,
): Promise<TURNCredentials> {
  const clusterDomain = normalizeClusterDomain(options.clusterDomain);
  if (!clusterDomain) {
    throw new Error("Cluster domain is required for TURN APP mode.");
  }
  const projectEndpoint = normalizeOptionalString(options.projectEndpoint);
  if (!projectEndpoint) {
    throw new Error("Project endpoint is required for TURN APP mode.");
  }
  const clientId = normalizeOptionalString(options.clientId);
  if (!clientId) {
    throw new Error("Client ID is required for TURN APP mode.");
  }
  const clientSecret = normalizeOptionalString(options.clientSecret);
  if (!clientSecret) {
    throw new Error("Client secret is required for TURN APP mode.");
  }
  const ttlSeconds = normalizeTTLSeconds(options.ttlSeconds);
  const exp = normalizeNow(options.now) + ttlSeconds;
  const username = `v1:${exp}:app:${projectEndpoint}:${clientId}`;
  const clientPrivateKey = crypto.createPrivateKey({
    key: Buffer.from(clientSecret, "hex"),
    format: "der",
    type: "pkcs8",
  });
  const serverPublicKeyHex =
    normalizeOptionalString(options.serverPublicKeyHex) ??
    (await loadTURNServerPublicKeyHex(clusterDomain, options));
  const serverPublicKey = crypto.createPublicKey({
    key: Buffer.from(serverPublicKeyHex, "hex"),
    format: "der",
    type: "spki",
  });
  const sharedSecret = crypto.diffieHellman({
    privateKey: clientPrivateKey,
    publicKey: serverPublicKey,
  });
  const key = Buffer.from(
    crypto.hkdfSync(
      "sha256",
      sharedSecret,
      Buffer.from(clusterDomain, "utf8"),
      Buffer.from("turn-app-v1", "utf8"),
      32,
    ),
  );
  const credential = crypto
    .createHmac("sha256", key)
    .update(username, "utf8")
    .digest("base64");
  return turnCredentialsSchema.parse({
    credential,
    ttl: ttlSeconds,
    urls: createTURNURLs(clusterDomain, options.turnPort, options.turnsPort),
    username,
  });
}

export async function createTURNCredentials(
  options: CreateTURNCredentialsOptions,
): Promise<TURNCredentials> {
  const credentials = options.credentials;
  const mode = resolveMode(credentials, options.mode);
  const projectEndpoint = normalizeOptionalString(options.projectEndpoint);
  if (mode === "api") {
    const controlPlaneCredentials =
      options.controlPlaneCredentials ?? credentials;
    if (!controlPlaneCredentials) {
      throw new Error(
        "Control-plane credentials are required for TURN API mode.",
      );
    }
    return await createAPITURNCredentials({
      apiUrl: options.apiUrl,
      credentials: controlPlaneCredentials,
      projectEndpoint,
      projectId: options.projectId,
    });
  }
  const clusterDomain =
    normalizeClusterDomain(options.clusterDomain) ??
    (projectEndpoint && options.engine
      ? deriveClusterDomainFromEngine(projectEndpoint, options.engine)
      : undefined);
  if (mode === "pat") {
    if (!isTokenCredentials(credentials)) {
      throw new Error("A PAT token is required for TURN PAT mode.");
    }
    return createPATTURNCredentials({
      clusterDomain: requireOption(
        clusterDomain,
        "Cluster domain is required for TURN PAT mode.",
      ),
      now: options.now,
      projectEndpoint: requireOption(
        projectEndpoint,
        "Project endpoint is required for TURN PAT mode.",
      ),
      token: credentials.token,
      tokenEndpoint: requireOption(
        normalizeOptionalString(options.tokenEndpoint),
        "Token endpoint is required for TURN PAT mode.",
      ),
      ttlSeconds: options.ttlSeconds,
      turnPort: options.turnPort,
      turnsPort: options.turnsPort,
    });
  }
  if (!isClientCredentials(credentials)) {
    throw new Error("Client credentials are required for TURN APP mode.");
  }
  return await createAPPTURNCredentials({
    apiUrl: options.apiUrl,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    clusterDomain: requireOption(
      clusterDomain,
      "Cluster domain is required for TURN APP mode.",
    ),
    keyringBaseUrl: options.keyringBaseUrl,
    now: options.now,
    projectEndpoint: requireOption(
      projectEndpoint,
      "Project endpoint is required for TURN APP mode.",
    ),
    serverPublicKeyHex: options.serverPublicKeyHex,
    ttlSeconds: options.ttlSeconds,
    turnPort: options.turnPort,
    turnsPort: options.turnsPort,
  });
}
