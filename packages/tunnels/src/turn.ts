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
const defaultTURNCredentialTTLSeconds = 24 * 60 * 60;

const turnTokenClaimsSchema = z.object({
  token_endpoint: z.string().optional(),
  type: z.string(),
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
  if (now instanceof Date) {
    return Math.floor(now.getTime() / 1000);
  }
  if (typeof now === "number" && Number.isFinite(now)) {
    return Math.floor(now);
  }
  return Math.floor(Date.now() / 1000);
}

function normalizeTTLSeconds(ttlSeconds?: number): number {
  if (
    typeof ttlSeconds === "number" &&
    Number.isFinite(ttlSeconds) &&
    ttlSeconds > 0
  ) {
    return Math.floor(ttlSeconds);
  }
  return defaultTURNCredentialTTLSeconds;
}

function normalizeTURNPort(port?: number): number {
  if (typeof port === "number" && Number.isFinite(port) && port > 0) {
    return Math.floor(port);
  }
  return defaultTURNPort;
}

function normalizeTURNSPort(port?: number): number {
  if (typeof port === "number" && Number.isFinite(port) && port > 0) {
    return Math.floor(port);
  }
  return defaultTURNSPort;
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
  const payload = Buffer.from(payloadPart, "base64url").toString("utf8");
  const parsed = turnTokenClaimsSchema.safeParse(JSON.parse(payload));
  if (!parsed.success) {
    throw new Error("Invalid token format.");
  }
  return parsed.data;
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
  if (isTokenCredentials(credentials)) {
    const claims = parseTURNTokenClaims(credentials.token);
    if (
      claims.type === "pat" &&
      normalizeOptionalString(claims.token_endpoint)
    ) {
      return "pat";
    }
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
  const tokenEndpoint = normalizeOptionalString(claims.token_endpoint);
  if (!tokenEndpoint) {
    throw new Error(
      "TURN PAT mode requires a PAT token carrying a token endpoint.",
    );
  }
  const ttlSeconds = normalizeTTLSeconds(options.ttlSeconds);
  const exp = normalizeNow(options.now) + ttlSeconds;
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
    ttl: ttlSeconds,
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
