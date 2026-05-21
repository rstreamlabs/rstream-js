// See LICENSE file in the project root for license information.

import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { readFile } from "node:fs/promises";
import { RuntimeError } from "./errors";
import { transportFromConfig } from "./transport";
import type { ConnectionOptions } from "node:tls";
import type { Logger } from "./logger";
import type { RstreamCredentials } from "@rstreamlabs/rstream";
import type { Transport } from "./transport";

export type RuntimeTLSOptions = Pick<
  ConnectionOptions,
  | "ca"
  | "cert"
  | "checkServerIdentity"
  | "key"
  | "rejectUnauthorized"
  | "servername"
>;

export interface ClientOptions {
  apiUrl?: string;
  configPath?: string;
  context?: string;
  credentials?: RstreamCredentials;
  engine?: string;
  heartbeat?: boolean;
  heartbeatIntervalMs?: number;
  logger?: Logger;
  noToken?: boolean;
  projectEndpoint?: string;
  readConfigFile?: boolean;
  requireToken?: boolean;
  tls?: RuntimeTLSOptions;
  token?: string;
  transport?: Transport;
  zeroRtt?: boolean;
}

export interface ResolvedClientOptions {
  apiUrl: string;
  credentials?: RstreamCredentials;
  engine?: string;
  heartbeat: boolean;
  heartbeatIntervalMs: number;
  noToken: boolean;
  projectEndpoint?: string;
  tls?: RuntimeTLSOptions;
  token?: string;
  transport?: Transport;
  zeroRtt: boolean;
}

interface EnvSettings {
  apiUrl?: string;
  configPath?: string;
  context?: string;
  engine?: string;
  mtlsCert?: string;
  mtlsKey?: string;
  token?: string;
  useQuic: boolean;
}

interface ConfigFile {
  defaults?: {
    context?: {
      name?: string;
    };
  };
  environments: EnvironmentConfig[];
  contexts: ContextConfig[];
}

interface EnvironmentConfig {
  apiUrl: string;
  auth?: AuthConfig;
  transport?: TransportConfig;
}

interface ContextConfig {
  apiUrl?: string;
  auth?: AuthConfig;
  engine?: string;
  name: string;
  projectEndpoint?: string;
  transport?: TransportConfig;
}

interface AuthConfig {
  mtls?: MTLSConfig;
  token?: TokenConfig;
}

interface TokenConfig {
  storage?: {
    account?: string;
    kind?: string;
    provider?: string;
    service?: string;
    value?: string;
  };
}

interface MTLSConfig {
  certificate?: string;
  certificateFile?: string;
  key?: string;
  keyFile?: string;
  storage?: MTLSStorageConfig;
}

interface MTLSStorageConfig {
  certificate?: string;
  certificateFile?: string;
  certificateIdHex?: string;
  certificateLabel?: string;
  certificateSHA256?: string;
  keyIdHex?: string;
  keyLabel?: string;
  kind?: string;
  maxSessions?: number;
  module?: string;
  opensslProvider?: string;
  pinEnv?: string;
  provider?: string;
  slot?: number;
  tokenLabel?: string;
  tokenSerial?: string;
}

export interface TransportConfig {
  bind?: {
    address?: string;
    interface?: string;
    mode?: string;
  };
  dns?: {
    dnssec?: boolean;
    override?: string;
    serverName?: string;
    tls?: boolean;
  };
  ipFamily?: string;
  mptcp?: boolean;
  proxy?: {
    fromEnvironment?: boolean;
    headers?: Record<string, string>;
    http?: string;
    password?: string;
    socks5?: string;
    tls?: {
      caFile?: string;
      insecureSkipVerify?: boolean;
      serverName?: string;
    };
    username?: string;
  };
  useQuic?: boolean;
}

interface ResolveConfigResult {
  apiUrl: string;
  context?: ContextConfig;
  environment?: EnvironmentConfig;
  token?: string;
  tls?: RuntimeTLSOptions;
  transportConfig?: TransportConfig;
}

const defaultAPIUrl = "https://rstream.io";

export function defaultConfigPath(): string {
  return join(homedir(), ".rstream", "config.yaml");
}

export async function resolveClientOptions(
  options: ClientOptions,
): Promise<ResolvedClientOptions> {
  const env = readEnv();
  const config = await resolveConfig(options, env);
  const explicitMTLS = envHasMTLS(env) || tlsHasClientCertificate(options.tls);
  const token =
    options.noToken === true
      ? undefined
      : firstDefined(
          options.token,
          credentialsToken(options.credentials),
          env.token,
          explicitMTLS ? undefined : config.token,
        );
  const tls = mergeTLSOptions(config.tls, options.tls);
  if (token !== undefined && tlsHasClientCertificate(tls)) {
    throw new RuntimeError(
      "Token authentication and mTLS authentication cannot be used together.",
      {
        code: "ERR_RSTREAM_AUTH_CONFLICT",
      },
    );
  }
  if (token !== undefined) validateTokenExpiry(token);
  if (env.useQuic) {
    throw new RuntimeError(
      "RSTREAM_QUIC_TRANSPORT is not supported by @rstreamlabs/runtime.",
      {
        code: "ERR_RSTREAM_UNSUPPORTED_TRANSPORT",
      },
    );
  }
  if (
    options.requireToken === true &&
    token === undefined &&
    !tlsHasClientCertificate(tls)
  ) {
    throw new RuntimeError("Authentication is required but not configured.", {
      code: "ERR_RSTREAM_AUTH_REQUIRED",
    });
  }
  return {
    apiUrl:
      firstDefined(options.apiUrl, env.apiUrl, config.apiUrl) ?? defaultAPIUrl,
    credentials: options.credentials,
    engine: normalizeOptional(
      firstDefined(
        options.engine,
        env.engine,
        config.context?.engine,
        config.engine,
      ),
    ),
    heartbeat: options.heartbeat ?? true,
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 5000,
    noToken:
      options.noToken ?? (token === undefined && !tlsHasClientCertificate(tls)),
    projectEndpoint: normalizeOptional(
      firstDefined(options.projectEndpoint, config.context?.projectEndpoint),
    ),
    tls,
    token,
    transport: options.transport ?? transportFromConfig(config.transportConfig),
    zeroRtt: options.zeroRtt ?? true,
  };
}

async function resolveConfig(
  options: ClientOptions,
  env: EnvSettings,
): Promise<ResolveConfigResult & { engine?: string }> {
  if (options.readConfigFile === false) {
    return {
      apiUrl: firstDefined(options.apiUrl, env.apiUrl) ?? defaultAPIUrl,
    };
  }
  const path =
    normalizeOptional(firstDefined(options.configPath, env.configPath)) ??
    defaultConfigPath();
  const file = await loadConfig(path);
  const apiUrlExplicit = normalizeAPIUrl(
    firstDefined(options.apiUrl, env.apiUrl),
  );
  const contextName = normalizeOptional(
    firstDefined(options.context, env.context, file.defaults?.context?.name),
  );
  const context =
    contextName === undefined
      ? undefined
      : findContext(file, contextName, apiUrlExplicit);
  const apiUrl =
    normalizeAPIUrl(firstDefined(apiUrlExplicit, context?.apiUrl)) ??
    defaultAPIUrl;
  const environment =
    context?.apiUrl === undefined ? undefined : findEnvironment(file, apiUrl);
  const token =
    options.noToken === true
      ? undefined
      : (env.token ??
        (envHasMTLS(env) || tlsHasClientCertificate(options.tls)
          ? undefined
          : resolveStoredToken(context, environment)));
  const explicitEngine = normalizeOptional(
    firstDefined(options.engine, env.engine),
  );
  const explicitToken =
    options.token !== undefined ||
    credentialsToken(options.credentials) !== undefined ||
    env.token !== undefined;
  if (
    explicitEngine !== undefined &&
    token !== undefined &&
    !explicitToken &&
    engineOverrideUsesStoredToken(explicitEngine, context)
  ) {
    throw new RuntimeError(
      "Refusing to use a stored token with an explicit engine override.",
      {
        code: "ERR_RSTREAM_STORED_TOKEN_ENGINE_OVERRIDE",
      },
    );
  }
  const tls = await resolveMTLSOptions(env, context, environment);
  if (
    explicitEngine !== undefined &&
    tlsHasClientCertificate(tls) &&
    !envHasMTLS(env) &&
    !tlsHasClientCertificate(options.tls) &&
    engineOverrideUsesStoredToken(explicitEngine, context)
  ) {
    throw new RuntimeError(
      "Refusing to use stored mTLS credentials with an explicit engine override.",
      {
        code: "ERR_RSTREAM_STORED_MTLS_ENGINE_OVERRIDE",
      },
    );
  }
  const transportConfig = mergeTransportConfig(
    environment?.transport,
    context?.transport,
  );
  return {
    apiUrl,
    context,
    environment,
    engine: firstDefined(explicitEngine, context?.engine),
    tls,
    token,
    transportConfig,
  };
}

function readEnv(): EnvSettings {
  return {
    apiUrl: normalizeAPIUrl(process.env.RSTREAM_API_URL),
    configPath: normalizeOptional(process.env.RSTREAM_CONFIG),
    context: normalizeOptional(process.env.RSTREAM_CONTEXT),
    engine: normalizeOptional(process.env.RSTREAM_ENGINE),
    mtlsCert: normalizeOptional(process.env.RSTREAM_MTLS_CERT_FILE),
    mtlsKey: normalizeOptional(process.env.RSTREAM_MTLS_KEY_FILE),
    token: normalizeOptional(process.env.RSTREAM_AUTHENTICATION_TOKEN),
    useQuic: process.env.RSTREAM_QUIC_TRANSPORT === "1",
  };
}

async function loadConfig(path: string): Promise<ConfigFile> {
  try {
    const content = await readFile(path, "utf8");
    const trimmed = content.trim();
    if (!trimmed) return emptyConfig();
    return normalizeConfig(parse(trimmed));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return emptyConfig();
    throw error;
  }
}

function emptyConfig(): ConfigFile {
  return { contexts: [], environments: [] };
}

function normalizeConfig(value: unknown): ConfigFile {
  const root = record(value);
  const defaults = recordOptional(root.defaults);
  const defaultContext = recordOptional(defaults?.context);
  return {
    contexts: arrayOfRecords(root.contexts)
      .map((ctx) => ({
        apiUrl: normalizeAPIUrl(stringOptional(ctx.apiUrl)),
        auth: authConfig(ctx.auth),
        engine: normalizeOptional(stringOptional(ctx.engine)),
        name: stringOptional(ctx.name) ?? "",
        projectEndpoint: normalizeOptional(stringOptional(ctx.projectEndpoint)),
        transport: transportConfig(ctx.transport),
      }))
      .filter((ctx) => ctx.name !== ""),
    defaults:
      defaultContext === undefined
        ? undefined
        : {
            context: {
              name: normalizeOptional(stringOptional(defaultContext.name)),
            },
          },
    environments: arrayOfRecords(root.environments)
      .map((env) => ({
        apiUrl: normalizeAPIUrl(stringOptional(env.apiUrl)) ?? "",
        auth: authConfig(env.auth),
        transport: transportConfig(env.transport),
      }))
      .filter((env) => env.apiUrl !== ""),
  };
}

function authConfig(value: unknown): AuthConfig | undefined {
  const auth = recordOptional(value);
  if (auth === undefined) return undefined;
  const token = recordOptional(auth.token);
  const storage = recordOptional(token?.storage);
  const mtls = recordOptional(auth.mtls);
  const mtlsStorage = recordOptional(mtls?.storage);
  return {
    mtls:
      mtls === undefined
        ? undefined
        : {
            certificate: stringOptional(mtls.certificate),
            certificateFile: stringOptional(mtls.certificateFile),
            key: stringOptional(mtls.key),
            keyFile: stringOptional(mtls.keyFile),
            storage:
              mtlsStorage === undefined
                ? undefined
                : {
                    certificate: stringOptional(mtlsStorage.certificate),
                    certificateFile: stringOptional(
                      mtlsStorage.certificateFile,
                    ),
                    certificateIdHex: stringOptional(
                      mtlsStorage.certificateIdHex,
                    ),
                    certificateLabel: stringOptional(
                      mtlsStorage.certificateLabel,
                    ),
                    certificateSHA256: stringOptional(
                      mtlsStorage.certificateSHA256,
                    ),
                    keyIdHex: stringOptional(mtlsStorage.keyIdHex),
                    keyLabel: stringOptional(mtlsStorage.keyLabel),
                    kind: stringOptional(mtlsStorage.kind),
                    maxSessions: numberOptional(mtlsStorage.maxSessions),
                    module: stringOptional(mtlsStorage.module),
                    opensslProvider: stringOptional(
                      mtlsStorage.opensslProvider,
                    ),
                    pinEnv: stringOptional(mtlsStorage.pinEnv),
                    provider: stringOptional(mtlsStorage.provider),
                    slot: numberOptional(mtlsStorage.slot),
                    tokenLabel: stringOptional(mtlsStorage.tokenLabel),
                    tokenSerial: stringOptional(mtlsStorage.tokenSerial),
                  },
          },
    token:
      storage === undefined
        ? undefined
        : {
            storage: {
              account: stringOptional(storage.account),
              kind: stringOptional(storage.kind),
              provider: stringOptional(storage.provider),
              service: stringOptional(storage.service),
              value: stringOptional(storage.value),
            },
          },
  };
}

function transportConfig(value: unknown): TransportConfig | undefined {
  const transport = recordOptional(value);
  if (transport === undefined) return undefined;
  const bind = recordOptional(transport.bind);
  const dns = recordOptional(transport.dns);
  const proxy = recordOptional(transport.proxy);
  const proxyTls = recordOptional(proxy?.tls);
  return {
    bind:
      bind === undefined
        ? undefined
        : {
            address: stringOptional(bind.address),
            interface: stringOptional(bind.interface),
            mode: stringOptional(bind.mode),
          },
    dns:
      dns === undefined
        ? undefined
        : {
            dnssec: booleanOptional(dns.dnssec),
            override: stringOptional(dns.override),
            serverName: stringOptional(dns.serverName),
            tls: booleanOptional(dns.tls),
          },
    ipFamily: stringOptional(transport.ipFamily),
    mptcp: booleanOptional(transport.mptcp),
    proxy:
      proxy === undefined
        ? undefined
        : {
            fromEnvironment: booleanOptional(proxy.fromEnvironment),
            headers: stringRecordOptional(proxy.headers),
            http: stringOptional(proxy.http),
            password: stringOptional(proxy.password),
            socks5: stringOptional(proxy.socks5),
            tls:
              proxyTls === undefined
                ? undefined
                : {
                    caFile: stringOptional(proxyTls.caFile),
                    insecureSkipVerify: booleanOptional(
                      proxyTls.insecureSkipVerify,
                    ),
                    serverName: stringOptional(proxyTls.serverName),
                  },
            username: stringOptional(proxy.username),
          },
    useQuic: booleanOptional(transport.useQuic),
  };
}

function findEnvironment(
  file: ConfigFile,
  apiUrl: string,
): EnvironmentConfig | undefined {
  return file.environments.find(
    (env) => normalizeAPIUrl(env.apiUrl) === apiUrl,
  );
}

function findContext(
  file: ConfigFile,
  name: string,
  apiUrl?: string,
): ContextConfig {
  const matches = file.contexts.filter((ctx) => ctx.name === name);
  if (matches.length === 0) {
    throw new RuntimeError(`Context "${name}" not found.`, {
      code: "ERR_RSTREAM_CONTEXT_NOT_FOUND",
    });
  }
  if (apiUrl !== undefined) {
    const exact = matches.find((ctx) => normalizeAPIUrl(ctx.apiUrl) === apiUrl);
    const unlinked = matches.find((ctx) => ctx.apiUrl === undefined);
    if (exact !== undefined) return exact;
    if (unlinked !== undefined && matches.length === 1) return unlinked;
    throw new RuntimeError(
      `Context "${name}" not found for API URL "${apiUrl}".`,
      {
        code: "ERR_RSTREAM_CONTEXT_NOT_FOUND",
      },
    );
  }
  if (matches.length > 1) {
    throw new RuntimeError(
      `Context "${name}" is ambiguous; set RSTREAM_API_URL or pass apiUrl.`,
      {
        code: "ERR_RSTREAM_CONTEXT_AMBIGUOUS",
      },
    );
  }
  const only = matches[0];
  if (only === undefined) {
    throw new RuntimeError(`Context "${name}" not found.`, {
      code: "ERR_RSTREAM_CONTEXT_NOT_FOUND",
    });
  }
  return only;
}

function resolveStoredToken(
  context?: ContextConfig,
  environment?: EnvironmentConfig,
): string | undefined {
  return tokenFromAuth(context?.auth) ?? tokenFromAuth(environment?.auth);
}

function tokenFromAuth(auth?: AuthConfig): string | undefined {
  const storage = auth?.token?.storage;
  if (storage === undefined) return undefined;
  if (storage.kind === undefined || storage.kind === "") {
    throw new RuntimeError("Token storage kind is required.", {
      code: "ERR_RSTREAM_INVALID_CONFIG",
    });
  }
  if (storage.kind === "inline") return normalizeOptional(storage.value);
  throw new RuntimeError(
    `Token storage kind "${storage.kind}" is not supported by @rstreamlabs/runtime.`,
    {
      code: "ERR_RSTREAM_UNSUPPORTED_CONFIG",
    },
  );
}

async function resolveMTLSOptions(
  env: EnvSettings,
  context?: ContextConfig,
  environment?: EnvironmentConfig,
): Promise<RuntimeTLSOptions | undefined> {
  if (env.mtlsCert !== undefined || env.mtlsKey !== undefined) {
    return await loadMTLSOptions({
      certificateFile: env.mtlsCert,
      keyFile: env.mtlsKey,
    });
  }
  return await loadMTLSOptions(context?.auth?.mtls ?? environment?.auth?.mtls);
}

async function loadMTLSOptions(
  mtls?: MTLSConfig,
): Promise<RuntimeTLSOptions | undefined> {
  if (mtls === undefined) return undefined;
  const cert = normalizeOptional(mtls.certificate);
  const key = normalizeOptional(mtls.key);
  const certFile = normalizeOptional(mtls.certificateFile);
  const keyFile = normalizeOptional(mtls.keyFile);
  const storageKind = normalizeOptional(mtls.storage?.kind);
  if (mtls.storage !== undefined) {
    if (
      cert !== undefined ||
      key !== undefined ||
      certFile !== undefined ||
      keyFile !== undefined
    ) {
      throw new RuntimeError(
        "mTLS storage cannot be mixed with certificate/key aliases.",
        {
          code: "ERR_RSTREAM_INVALID_CONFIG",
        },
      );
    }
    if (storageKind === undefined) {
      throw new RuntimeError("mTLS storage kind is required.", {
        code: "ERR_RSTREAM_INVALID_CONFIG",
      });
    }
    throw new RuntimeError(
      `mTLS storage kind "${storageKind}" is not supported by @rstreamlabs/runtime.`,
      {
        code: "ERR_RSTREAM_UNSUPPORTED_CONFIG",
      },
    );
  }
  if (
    cert === undefined &&
    key === undefined &&
    certFile === undefined &&
    keyFile === undefined
  )
    return undefined;
  if (
    (cert !== undefined || key !== undefined) &&
    (certFile !== undefined || keyFile !== undefined)
  ) {
    throw new RuntimeError(
      "mTLS certificate and key must be configured inline or with files, not both.",
      {
        code: "ERR_RSTREAM_INVALID_CONFIG",
      },
    );
  }
  if (cert !== undefined || key !== undefined) {
    if (cert === undefined || key === undefined) {
      throw new RuntimeError(
        "mTLS inline certificate and key are both required.",
        {
          code: "ERR_RSTREAM_INVALID_CONFIG",
        },
      );
    }
    return { cert, key };
  }
  if (certFile === undefined || keyFile === undefined) {
    throw new RuntimeError(
      "mTLS certificate and key files are both required.",
      {
        code: "ERR_RSTREAM_INVALID_CONFIG",
      },
    );
  }
  return {
    cert: await readFile(certFile, "utf8"),
    key: await readFile(keyFile, "utf8"),
  };
}

function mergeTLSOptions(
  base?: RuntimeTLSOptions,
  override?: RuntimeTLSOptions,
): RuntimeTLSOptions | undefined {
  if (base === undefined) return override;
  if (override === undefined) return base;
  return { ...base, ...override };
}

function tlsHasClientCertificate(tls?: RuntimeTLSOptions): boolean {
  return tls?.cert !== undefined || tls?.key !== undefined;
}

function envHasMTLS(env: EnvSettings): boolean {
  return env.mtlsCert !== undefined || env.mtlsKey !== undefined;
}

function validateTokenExpiry(token: string): void {
  const parts = token.split(".");
  if (parts.length < 2) return;
  const payloadPart = parts[1];
  if (payloadPart === undefined) return;
  const payload = decodeTokenPayload(payloadPart);
  if (payload === undefined) return;
  const exp = numberOptional(payload.exp);
  if (exp !== undefined && exp <= Math.floor(Date.now() / 1000)) {
    throw new RuntimeError("Token has expired.", {
      code: "ERR_RSTREAM_TOKEN_EXPIRED",
    });
  }
}

function decodeTokenPayload(
  payload: string,
): Record<string, unknown> | undefined {
  try {
    return record(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
  } catch {
    return undefined;
  }
}

function mergeTransportConfig(
  base?: TransportConfig,
  override?: TransportConfig,
): TransportConfig | undefined {
  if (base === undefined) return override;
  if (override === undefined) return base;
  return {
    bind: { ...base.bind, ...override.bind },
    dns: { ...base.dns, ...override.dns },
    ipFamily: override.ipFamily ?? base.ipFamily,
    mptcp: override.mptcp ?? base.mptcp,
    proxy: {
      ...base.proxy,
      ...override.proxy,
      headers: { ...base.proxy?.headers, ...override.proxy?.headers },
    },
    useQuic: override.useQuic ?? base.useQuic,
  };
}

function engineOverrideUsesStoredToken(
  engine: string,
  context?: ContextConfig,
): boolean {
  if (context?.engine === undefined) return true;
  return context.engine !== engine;
}

function credentialsToken(
  credentials?: RstreamCredentials,
): string | undefined {
  return credentials !== undefined && "token" in credentials
    ? credentials.token
    : undefined;
}

function normalizeAPIUrl(value?: string): string | undefined {
  const normalized = normalizeOptional(value);
  if (normalized === undefined) return undefined;
  return normalized.replace(/\/+$/, "");
}

function normalizeOptional(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  return values.find((value) => value !== undefined);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value));
  }
  return {};
}

function recordOptional(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value));
  }
  return undefined;
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(record) : [];
}

function stringOptional(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function booleanOptional(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function numberOptional(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringRecordOptional(
  value: unknown,
): Record<string, string> | undefined {
  const input = recordOptional(value);
  if (input === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(input).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
