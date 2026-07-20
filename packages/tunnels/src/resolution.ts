// See LICENSE file in the project root for license information.

import { DEFAULT_API_URL } from "@rstreamlabs/rstream";
import { getTunnelsProjectEngine } from "@rstreamlabs/rstream";
import { isTokenCredentials } from "@rstreamlabs/rstream";
import { readEnvironment } from "@rstreamlabs/rstream";
import { RstreamClient } from "@rstreamlabs/rstream";
import type { RstreamCredentials } from "@rstreamlabs/rstream";
import type { ControlPlaneHeaders } from "@rstreamlabs/rstream";
import type { TunnelsProject } from "@rstreamlabs/rstream";

export interface TunnelsResolutionConfig {
  apiUrl?: string;
  controlPlaneCredentials?: RstreamCredentials;
  controlPlaneHeaders?: ControlPlaneHeaders;
  credentials?: RstreamCredentials;
  engine?: string;
  projectEndpoint?: string;
  region?: string;
  token?: string;
}

function trimOptionalString(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

const dnsLabelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function validateHostname(hostname: string): boolean {
  if (!hostname || hostname.length > 253 || hostname.includes("..")) {
    return false;
  }
  return hostname
    .split(".")
    .every((label) => label === "localhost" || dnsLabelPattern.test(label));
}

export function normalizeEngineAddress(engine: string): string {
  const normalized = engine.trim();
  if (
    !normalized ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(normalized) ||
    /[/?#@\\\s]/.test(normalized)
  ) {
    throw new Error("Engine must be a host[:port] value.");
  }
  const explicitPort = normalized.match(/:(\d+)$/)?.[1];
  const url = new URL(`https://${normalized}`);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Engine must be a host[:port] value.");
  }
  if (!validateHostname(url.hostname)) {
    throw new Error("Engine must use a valid hostname.");
  }
  if (explicitPort) {
    const port = Number(explicitPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Engine port must be an integer between 1 and 65535.");
    }
  }
  return `${url.hostname.toLowerCase()}${explicitPort ? `:${explicitPort}` : ""}`;
}

export function resolveTunnelsAPIURL(apiUrl?: string): string {
  return (
    trimOptionalString(apiUrl) ?? readEnvironment().apiUrl ?? DEFAULT_API_URL
  );
}

export function resolveTunnelsRegion(region?: string): string | undefined {
  const value = trimOptionalString(region) ?? readEnvironment().region;
  if (value === undefined || value.toLowerCase() === "auto") return undefined;
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/i.test(value)) {
    throw new Error(
      "Region can only contain letters, numbers, dots, underscores, or hyphens.",
    );
  }
  return value.toLowerCase();
}

export function resolveTunnelsCredentials(
  credentials?: RstreamCredentials,
): RstreamCredentials | undefined {
  if (credentials !== undefined) {
    return credentials;
  }
  const token = readEnvironment().token;
  if (!token) {
    return undefined;
  }
  return { token };
}

export function resolveControlPlaneCredentials(
  controlPlaneCredentials?: RstreamCredentials,
  credentials?: RstreamCredentials,
  authToken?: string,
): RstreamCredentials | undefined {
  if (controlPlaneCredentials !== undefined) {
    return controlPlaneCredentials;
  }
  if (credentials !== undefined) {
    return credentials;
  }
  if (authToken) {
    return { token: authToken };
  }
  const environmentToken = readEnvironment().token;
  if (!environmentToken) {
    return undefined;
  }
  return { token: environmentToken };
}

export async function resolveTunnelsEngine(
  config: TunnelsResolutionConfig,
): Promise<string> {
  const region = resolveTunnelsRegion(config.region);
  const explicitEngine = trimOptionalString(config.engine);
  const environmentEngine = readEnvironment().engine;
  if (region !== undefined && (explicitEngine || environmentEngine)) {
    throw new Error(
      "Region selection cannot be combined with an explicit engine override.",
    );
  }
  if (region !== undefined) {
    const project = await resolveManagedTunnelsProject(config);
    const engine = getTunnelsProjectEngine(project, region);
    if (engine) return normalizeEngineAddress(engine);
    throw new Error(
      "Failed to resolve the selected regional engine from the managed tunnels project.",
    );
  }
  if (explicitEngine) {
    return normalizeEngineAddress(explicitEngine);
  }
  if (environmentEngine) {
    return normalizeEngineAddress(environmentEngine);
  }
  const token =
    trimOptionalString(config.token) ??
    (isTokenCredentials(config.credentials)
      ? config.credentials.token
      : undefined);
  const projectEndpoint = trimOptionalString(config.projectEndpoint);
  if (projectEndpoint) {
    const project = await resolveManagedTunnelsProject({
      ...config,
      token,
    });
    const engine = getTunnelsProjectEngine(project, region);
    if (engine) {
      return normalizeEngineAddress(engine);
    }
    throw new Error(
      "Failed to resolve the engine address from the managed tunnels project.",
    );
  }
  throw new Error(
    "Engine URL is not defined. Provide an engine, use RSTREAM_ENGINE, or configure a managed project endpoint with Control plane API access.",
  );
}

export async function resolveManagedTunnelsProject(
  config: TunnelsResolutionConfig,
): Promise<TunnelsProject> {
  const projectEndpoint = trimOptionalString(config.projectEndpoint);
  if (!projectEndpoint) {
    throw new Error("Managed project endpoint is required.");
  }
  const credentials = resolveControlPlaneCredentials(
    config.controlPlaneCredentials,
    config.credentials,
    config.token,
  );
  if (credentials === undefined) {
    throw new Error(
      "Control-plane credentials are required to resolve a managed project endpoint.",
    );
  }
  const controlPlane = new RstreamClient({
    apiUrl: resolveTunnelsAPIURL(config.apiUrl),
    controlPlaneHeaders: config.controlPlaneHeaders,
    credentials,
  });
  return await controlPlane.tunnels.projects.resolveByEndpoint(projectEndpoint);
}
