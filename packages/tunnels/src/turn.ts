// See LICENSE file in the project root for license information.

import { isClientCredentials } from "@rstreamlabs/rstream";
import { createClientCredentialsToken } from "@rstreamlabs/rstream";
import { isTokenCredentials } from "@rstreamlabs/rstream";
import { RstreamClient } from "@rstreamlabs/rstream";
import { RstreamHTTPError } from "@rstreamlabs/rstream";
import { RstreamTunnelsClient } from "./tunnels";
import { hasClientCertificate } from "./engine-http";
import { requestLifetime } from "./http-lifetime";
import { waitWithSignal } from "./http-lifetime";
import { turnCredentialsSchema } from "@rstreamlabs/rstream/turn";
import { createBoundedControlPlaneFetch } from "./control-plane-fetch";
import * as z from "zod";
import crypto from "crypto";
import type { CreateTurnCredentialsParams } from "@rstreamlabs/rstream/turn";
import type { RstreamCredentials } from "@rstreamlabs/rstream";
import type { TURNCredentials } from "@rstreamlabs/rstream/turn";
import type { EngineTLSOptions } from "./node-engine-http";
import type { ControlPlaneHeaders } from "@rstreamlabs/rstream";

const defaultTURNPort = 3478;
const defaultTURNSPort = 5349;
const defaultTURNCredentialTTLSeconds = 10 * 60;
const maxTURNCredentialTTLSeconds = 60 * 60;
const maxTURNKeyringBytes = 8 * 1024;
const defaultAPIRequestTimeoutMilliseconds = 10_000;
const maxAPIRequestTimeoutMilliseconds = 60_000;

const turnTokenClaimsSchema = z.object({
  permissions: z.array(z.string()).nullable().optional(),
  exp: z.number().int().optional(),
  iat: z.number().int().optional(),
  token_endpoint: z
    .string()
    .regex(/^[A-Za-z0-9_.-]{1,128}$/)
    .optional(),
  tokendpoint: z
    .string()
    .regex(/^[A-Za-z0-9_.-]{1,128}$/)
    .optional(),
  type: z.enum(["app", "auth", "pat"]),
});

export const turnCredentialModeSchema = z.enum([
  "auto",
  "api",
  "engine",
  "app",
  "pat",
]);

export type TURNCredentialMode = z.infer<typeof turnCredentialModeSchema>;

export interface CreateAPITURNCredentialsOptions {
  controlPlaneHeaders?: ControlPlaneHeaders;
  signal?: AbortSignal;
  apiUrl?: string;
  credentials: RstreamCredentials;
  fetch?: typeof globalThis.fetch;
  projectEndpoint?: string;
  projectId?: string;
  requestTimeoutMilliseconds?: number;
  ttlSeconds?: number;
}

export interface CreatePATTURNCredentialsOptions {
  clusterDomain?: string;
  now?: Date | number;
  projectEndpoint: string;
  token: string;
  tokenEndpoint?: string;
  ttlSeconds?: number;
  turnDomain?: string;
  turnPort?: number;
  turnRealm?: string;
  turnsPort?: number;
}

export interface CreateAPPTURNCredentialsOptions {
  signal?: AbortSignal;
  requestTimeoutMilliseconds?: number;
  apiUrl?: string;
  clientId: string;
  clientSecret: string;
  clusterDomain?: string;
  keyringBaseUrl?: string;
  now?: Date | number;
  projectEndpoint: string;
  serverPublicKeyHex?: string;
  ttlSeconds?: number;
  turnDomain?: string;
  turnPort?: number;
  turnRealm?: string;
  turnsPort?: number;
}

export interface CreateTURNCredentialsOptions {
  controlPlaneHeaders?: ControlPlaneHeaders;
  client?: RstreamTunnelsClient;
  tls?: EngineTLSOptions;
  mtlsApiUrl?: string;
  signal?: AbortSignal;
  apiUrl?: string;
  clusterDomain?: string;
  controlPlaneCredentials?: RstreamCredentials;
  credentials?: RstreamCredentials;
  engine?: string;
  fetch?: typeof globalThis.fetch;
  keyringBaseUrl?: string;
  mode?: TURNCredentialMode;
  now?: Date | number;
  projectEndpoint?: string;
  projectId?: string;
  requestTimeoutMilliseconds?: number;
  serverPublicKeyHex?: string;
  tokenEndpoint?: string;
  ttlSeconds?: number;
  turnDomain?: string;
  turnPort?: number;
  turnRealm?: string;
  turnsPort?: number;
}

function normalizeOptionalString(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeClusterDomain(clusterDomain?: string): string | undefined {
  const normalized = normalizeOptionalString(clusterDomain);
  if (
    normalized &&
    (normalized.length > 253 ||
      !normalized
        .split(".")
        .every((label) =>
          /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
        ))
  )
    throw new Error("TURN domain and realm must be valid DNS names.");
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

function normalizeAPIRequestTimeoutMilliseconds(
  timeoutMilliseconds?: number,
): number {
  const timeout = timeoutMilliseconds ?? defaultAPIRequestTimeoutMilliseconds;
  if (
    !Number.isInteger(timeout) ||
    timeout < 1 ||
    timeout > maxAPIRequestTimeoutMilliseconds
  ) {
    throw new Error(
      "TURN API request timeout must be an integer between 1 and 60000 milliseconds.",
    );
  }
  return timeout;
}

function createAPITURNCredentialsParams(
  ttlSeconds?: number,
): CreateTurnCredentialsParams {
  return ttlSeconds === undefined
    ? {}
    : { ttlSeconds: normalizeTTLSeconds(ttlSeconds) };
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
  turnDomain: string,
  turnPort?: number,
  turnsPort?: number,
): string[] {
  const normalizedTURNPort = normalizeTURNPort(turnPort);
  const normalizedTURNSPort = normalizeTURNSPort(turnsPort);
  return [
    `turn:${turnDomain}:${normalizedTURNPort}?transport=udp`,
    `turn:${turnDomain}:${normalizedTURNPort}?transport=tcp`,
    `turns:${turnDomain}:${normalizedTURNSPort}?transport=udp`,
    `turns:${turnDomain}:${normalizedTURNSPort}?transport=tcp`,
  ];
}

function parseTURNTokenClaims(token: string) {
  const parts = token.split(".");
  const payloadPart = parts.at(1);
  if (!payloadPart) {
    throw new Error("Invalid token format.");
  }
  const decoded = parseTURNTokenPayload(payloadPart);
  const parsed = turnTokenClaimsSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error("Invalid token format.");
  }
  return parsed.data;
}

function parseTURNTokenPayload(payloadPart: string): unknown {
  try {
    const payload = Buffer.from(payloadPart, "base64url").toString("utf8");
    return JSON.parse(payload);
  } catch {
    throw new Error("Invalid token format.");
  }
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

function automaticPATClaims(
  token: string,
): z.infer<typeof turnTokenClaimsSchema> | undefined {
  try {
    return parseTURNTokenClaims(token);
  } catch {
    return undefined;
  }
}

function resolveMode(
  options: CreateTURNCredentialsOptions,
): TURNCredentialMode {
  const requested = turnCredentialModeSchema.parse(options.mode ?? "auto");
  if (requested !== "auto") return requested;
  if (options.client?.usesMTLS || hasClientCertificate(options.tls))
    return "engine";
  const claims = isTokenCredentials(options.credentials)
    ? automaticPATClaims(options.credentials.token)
    : undefined;
  if (
    claims?.token_endpoint &&
    claims.tokendpoint &&
    claims.token_endpoint !== claims.tokendpoint
  )
    throw new Error("Conflicting PAT token endpoints.");
  const localTarget =
    options.projectEndpoint &&
    (options.clusterDomain || (options.turnDomain && options.turnRealm));
  if (!localTarget) return "auto";
  if (isClientCredentials(options.credentials)) return "app";
  if (
    claims?.type === "pat" &&
    claims.exp !== undefined &&
    (claims.token_endpoint || claims.tokendpoint) &&
    (claims.permissions === null ||
      claims.permissions?.includes("turn.relay.allocate"))
  )
    return "pat";
  return "auto";
}

async function readBoundedTURNKeyring(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  chunks: Uint8Array[] = [],
  size = 0,
): Promise<string> {
  const result = await reader.read();
  if (result.done) {
    return Buffer.concat(chunks, size).toString("utf8");
  }
  const nextSize = size + result.value.byteLength;
  if (nextSize > maxTURNKeyringBytes) {
    await reader.cancel();
    throw new Error("TURN keyring response exceeds the 8 KiB limit.");
  }
  return await readBoundedTURNKeyring(
    reader,
    [...chunks, result.value],
    nextSize,
  );
}

function parseTURNServerPublicKeyHex(value: string): crypto.KeyObject {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maxTURNKeyringBytes ||
    normalized.length % 2 !== 0 ||
    !/^[0-9a-f]+$/i.test(normalized)
  ) {
    throw new Error("TURN keyring must contain hexadecimal DER key material.");
  }
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(normalized, "hex"),
      format: "der",
      type: "spki",
    });
    if (key.asymmetricKeyType !== "ec") {
      throw new Error("TURN keyring public key must be an EC key.");
    }
    return key;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("TURN keyring")) {
      throw error;
    }
    throw new Error("TURN keyring contains an invalid DER public key.", {
      cause: error,
    });
  }
}

function parseAPPPrivateKey(value: string): crypto.KeyObject {
  if (
    value.length > 16384 ||
    value.length % 2 !== 0 ||
    !/^[0-9a-f]+$/i.test(value)
  )
    throw new Error(
      "TURN APP client secret must contain hexadecimal DER key material.",
    );
  try {
    const key = crypto.createPrivateKey({
      key: Buffer.from(value, "hex"),
      format: "der",
      type: "pkcs8",
    });
    if (key.asymmetricKeyType !== "ec") {
      throw new Error("TURN APP client secret must contain an EC private key.");
    }
    return key;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("TURN APP")) {
      throw error;
    }
    throw new Error("TURN APP client secret contains an invalid private key.", {
      cause: error,
    });
  }
}

function requireMatchingCurve(
  privateKey: crypto.KeyObject,
  publicKey: crypto.KeyObject,
): void {
  const privateCurve = privateKey.asymmetricKeyDetails?.namedCurve;
  const publicCurve = publicKey.asymmetricKeyDetails?.namedCurve;
  if (!privateCurve || privateCurve !== publicCurve) {
    throw new Error(
      "TURN APP client and server keys must use the same named curve.",
    );
  }
}

async function loadTURNServerPublicKeyHex(
  clusterDomain: string,
  options: {
    apiUrl?: string;
    keyringBaseUrl?: string;
    signal?: AbortSignal;
    requestTimeoutMilliseconds?: number;
  },
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
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error(
      "TURN keyring requests require HTTPS without URL credentials.",
    );
  const lifetime = requestLifetime(
    [options.signal],
    normalizeAPIRequestTimeoutMilliseconds(options.requestTimeoutMilliseconds),
  );
  try {
    const response = await fetch(url, {
      redirect: "manual",
      credentials: "omit",
      signal: lifetime.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error(
        "TURN keyring request was redirected; redirects are refused.",
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`TURN keyring request returned HTTP ${response.status}.`);
    }
    if (!response.body) {
      throw new Error("TURN keyring response body is missing.");
    }
    const reader = response.body.getReader();
    return (
      await readBoundedTURNKeyring(reader).finally(() => reader.releaseLock())
    ).trim();
  } finally {
    lifetime.close();
  }
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
  const requestTimeoutMilliseconds = normalizeAPIRequestTimeoutMilliseconds(
    options.requestTimeoutMilliseconds,
  );
  const params = createAPITURNCredentialsParams(options.ttlSeconds);
  const request = createBoundedControlPlaneFetch(
    requestTimeoutMilliseconds,
    options.signal,
    options.fetch,
  );
  const client = new RstreamClient({
    controlPlaneHeaders: options.controlPlaneHeaders,
    apiUrl: options.apiUrl,
    credentials: isClientCredentials(options.credentials)
      ? {
          token: createClientCredentialsToken(options.credentials, {
            expiresInSeconds: 60,
            claims: { permissions: ["turn.credentials.create"] },
          }).token,
        }
      : options.credentials,
    fetch: request,
  });
  if (projectId) {
    return await client.tunnels.projects.createTurnCredentials(
      projectId,
      params,
    );
  }
  if (!projectEndpoint) {
    throw new Error(
      "Project ID or project endpoint is required for TURN API mode.",
    );
  }
  return await client.tunnels.projects.createTurnCredentialsByEndpoint(
    projectEndpoint,
    params,
  );
}

export function createPATTURNCredentials(
  options: CreatePATTURNCredentialsOptions,
): TURNCredentials {
  const legacyDomain = normalizeClusterDomain(options.clusterDomain);
  const turnDomain = normalizeClusterDomain(options.turnDomain) ?? legacyDomain;
  const turnRealm = normalizeClusterDomain(options.turnRealm) ?? legacyDomain;
  if (!turnDomain) {
    throw new Error("TURN domain is required for TURN PAT mode.");
  }
  if (!turnRealm) {
    throw new Error("TURN realm is required for TURN PAT mode.");
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
  const claimsTokenEndpoint = normalizeOptionalString(
    claims.token_endpoint ?? claims.tokendpoint,
  );
  if (
    claims.token_endpoint &&
    claims.tokendpoint &&
    claims.token_endpoint !== claims.tokendpoint
  )
    throw new Error("Conflicting PAT token endpoints.");
  const configuredTokenEndpoint = normalizeOptionalString(
    options.tokenEndpoint,
  );
  const tokenEndpoint = configuredTokenEndpoint ?? claimsTokenEndpoint;
  if (!tokenEndpoint) {
    throw new Error(
      "TURN PAT mode requires a PAT token carrying a token endpoint.",
    );
  }
  requireTURNReference(projectEndpoint);
  requireTURNReference(tokenEndpoint);
  if (
    configuredTokenEndpoint !== undefined &&
    claimsTokenEndpoint !== undefined &&
    claimsTokenEndpoint !== configuredTokenEndpoint
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
      Buffer.from(turnRealm, "utf8"),
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
    urls: createTURNURLs(turnDomain, options.turnPort, options.turnsPort),
    username,
  });
}

export async function createAPPTURNCredentials(
  options: CreateAPPTURNCredentialsOptions,
): Promise<TURNCredentials> {
  const legacyDomain = normalizeClusterDomain(options.clusterDomain);
  const turnDomain = normalizeClusterDomain(options.turnDomain) ?? legacyDomain;
  const turnRealm = normalizeClusterDomain(options.turnRealm) ?? legacyDomain;
  if (!turnDomain) {
    throw new Error("TURN domain is required for TURN APP mode.");
  }
  if (!turnRealm) {
    throw new Error("TURN realm is required for TURN APP mode.");
  }
  const projectEndpoint = normalizeOptionalString(options.projectEndpoint);
  if (!projectEndpoint) {
    throw new Error("Project endpoint is required for TURN APP mode.");
  }
  const clientId = normalizeOptionalString(options.clientId);
  if (!clientId) {
    throw new Error("Client ID is required for TURN APP mode.");
  }
  requireTURNReference(projectEndpoint);
  requireTURNReference(clientId);
  const clientSecret = normalizeOptionalString(options.clientSecret);
  if (!clientSecret) {
    throw new Error("Client secret is required for TURN APP mode.");
  }
  const ttlSeconds = normalizeTTLSeconds(options.ttlSeconds);
  const exp = normalizeNow(options.now) + ttlSeconds;
  const username = `v1:${exp}:app:${projectEndpoint}:${clientId}`;
  const clientPrivateKey = parseAPPPrivateKey(clientSecret);
  const serverPublicKeyHex =
    normalizeOptionalString(options.serverPublicKeyHex) ??
    (await loadTURNServerPublicKeyHex(turnRealm, options));
  const serverPublicKey = parseTURNServerPublicKeyHex(serverPublicKeyHex);
  requireMatchingCurve(clientPrivateKey, serverPublicKey);
  const sharedSecret = crypto.diffieHellman({
    privateKey: clientPrivateKey,
    publicKey: serverPublicKey,
  });
  const key = Buffer.from(
    crypto.hkdfSync(
      "sha256",
      sharedSecret,
      Buffer.from(turnRealm, "utf8"),
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
    urls: createTURNURLs(turnDomain, options.turnPort, options.turnsPort),
    username,
  });
}

async function createTURNCredentialsForLifetime(
  options: CreateTURNCredentialsOptions,
): Promise<TURNCredentials> {
  const credentials = options.credentials;
  const mode = resolveMode(options);
  const projectEndpoint = normalizeOptionalString(options.projectEndpoint);
  if (mode === "engine") return createEngineTURNCredentials(options);
  if (options.client?.usesMTLS || hasClientCertificate(options.tls))
    throw new Error(
      "Certificate authentication requires automatic or Engine TURN mode.",
    );
  if (mode === "api" || mode === "auto") {
    const controlPlaneCredentials =
      options.controlPlaneCredentials ?? credentials;
    if (!controlPlaneCredentials) {
      if (mode === "auto" && (options.client || options.engine))
        return createEngineTURNCredentials(options);
      throw new Error(
        "Control-plane credentials are required for TURN API mode.",
      );
    }
    try {
      return await createAPITURNCredentials({
        controlPlaneHeaders: options.controlPlaneHeaders,
        apiUrl: options.apiUrl,
        credentials: controlPlaneCredentials,
        fetch: options.fetch,
        projectEndpoint,
        projectId: options.projectId,
        requestTimeoutMilliseconds:
          mode === "auto"
            ? Math.min(options.requestTimeoutMilliseconds ?? 10000, 5000)
            : options.requestTimeoutMilliseconds,
        signal: options.signal,
        ttlSeconds: options.ttlSeconds,
      });
    } catch (error) {
      if (
        mode !== "auto" ||
        !projectEndpoint ||
        !(options.client?.configuredEngine || options.engine) ||
        !turnEngineFallbackAllowed(error, options.signal)
      )
        throw error;
      return createEngineTURNCredentials(options);
    }
  }
  const legacyDomain = normalizeClusterDomain(options.clusterDomain);
  const turnDomain =
    normalizeClusterDomain(options.turnDomain) ??
    legacyDomain ??
    (projectEndpoint && options.engine
      ? deriveClusterDomainFromEngine(projectEndpoint, options.engine)
      : undefined);
  const turnRealm = normalizeClusterDomain(options.turnRealm) ?? legacyDomain;
  if (mode === "pat") {
    if (!isTokenCredentials(credentials)) {
      throw new Error("A PAT token is required for TURN PAT mode.");
    }
    return createPATTURNCredentials({
      now: options.now,
      projectEndpoint: requireOption(
        projectEndpoint,
        "Project endpoint is required for TURN PAT mode.",
      ),
      token: credentials.token,
      tokenEndpoint: options.tokenEndpoint,
      ttlSeconds: options.ttlSeconds,
      turnDomain: requireOption(
        turnDomain,
        "TURN domain is required for TURN PAT mode.",
      ),
      turnPort: options.turnPort,
      turnRealm: requireOption(
        turnRealm,
        "TURN realm is required for TURN PAT mode.",
      ),
      turnsPort: options.turnsPort,
    });
  }
  if (!isClientCredentials(credentials)) {
    throw new Error("Client credentials are required for TURN APP mode.");
  }
  return await createAPPTURNCredentials({
    signal: options.signal,
    requestTimeoutMilliseconds: options.requestTimeoutMilliseconds,
    apiUrl: options.apiUrl,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    keyringBaseUrl: options.keyringBaseUrl,
    now: options.now,
    projectEndpoint: requireOption(
      projectEndpoint,
      "Project endpoint is required for TURN APP mode.",
    ),
    serverPublicKeyHex: options.serverPublicKeyHex,
    ttlSeconds: options.ttlSeconds,
    turnDomain: requireOption(
      turnDomain,
      "TURN domain is required for TURN APP mode.",
    ),
    turnPort: options.turnPort,
    turnRealm: requireOption(
      turnRealm,
      "TURN realm is required for TURN APP mode.",
    ),
    turnsPort: options.turnsPort,
  });
}

function requireTURNReference(value: string): void {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(value) || value === "-")
    throw new Error("Invalid TURN project or credential reference.");
}

function turnEngineFallbackAllowed(
  error: unknown,
  signal?: AbortSignal,
): boolean {
  if (signal?.aborted) return false;
  if (error instanceof RstreamHTTPError)
    return [502, 503, 504].includes(error.status);
  if (error instanceof DOMException && error.name === "TimeoutError")
    return true;
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && typeof error.code === "string")
    return [
      "ENOTFOUND",
      "EAI_AGAIN",
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_SOCKET",
    ].includes(error.code);
  return "cause" in error && error.cause !== error
    ? turnEngineFallbackAllowed(error.cause, signal)
    : false;
}

async function createEngineTURNCredentials(
  options: CreateTURNCredentialsOptions,
): Promise<TURNCredentials> {
  const client =
    options.client ??
    new RstreamTunnelsClient({
      credentials: options.credentials,
      tls: options.tls,
      mtlsApiUrl: options.mtlsApiUrl,
      engine: options.engine,
      projectEndpoint: options.projectEndpoint,
      projectId: options.projectId,
    });
  try {
    const engine = await client.getEngine();
    const endpoint = new URL(`https://${engine}`).hostname.split(".")[0];
    if (
      (options.projectEndpoint && options.projectEndpoint !== endpoint) ||
      (options.projectId && !options.projectEndpoint)
    )
      throw new Error("TURN project endpoint must match the Engine client.");
    if (options.engine && options.engine !== engine)
      throw new Error("TURN Engine must match the reusable client.");
    const value = await client.request<unknown>(
      "/turn-server/credentials",
      {
        method: "POST",
        signal: options.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createAPITURNCredentialsParams(options.ttlSeconds),
        ),
      },
      16384,
    );
    return turnCredentialsSchema.parse(value);
  } finally {
    if (!options.client) await client.close();
  }
}

export function validateTURNCredentialsRequest(
  options: CreateTURNCredentialsOptions,
): number {
  normalizeTTLSeconds(options.ttlSeconds);
  turnCredentialModeSchema.parse(options.mode ?? "auto");
  return normalizeAPIRequestTimeoutMilliseconds(
    options.requestTimeoutMilliseconds,
  );
}

export async function createTURNCredentials(
  options: CreateTURNCredentialsOptions,
): Promise<TURNCredentials> {
  const lifetime = requestLifetime(
    [options.signal],
    validateTURNCredentialsRequest(options),
  );
  try {
    lifetime.signal.throwIfAborted();
    if (
      (options.client?.usesMTLS || hasClientCertificate(options.tls)) &&
      options.credentials
    )
      throw new Error("Use a token or mTLS, not both.");
    if (
      options.client &&
      options.credentials &&
      !sameTURNCredentials(options.client.credentials, options.credentials)
    )
      throw new Error(
        "TURN credentials must match the reusable Engine client.",
      );
    return await waitWithSignal(
      createTURNCredentialsForLifetime({
        ...options,
        credentials: options.credentials ?? options.client?.credentials,
        signal: lifetime.signal,
      }),
      lifetime.signal,
    );
  } finally {
    lifetime.close();
  }
}

function sameTURNCredentials(
  left: RstreamCredentials | undefined,
  right: RstreamCredentials,
): boolean {
  if (isTokenCredentials(left) && isTokenCredentials(right))
    return left.token === right.token;
  return (
    isClientCredentials(left) &&
    isClientCredentials(right) &&
    left.clientId === right.clientId &&
    left.clientSecret === right.clientSecret
  );
}
