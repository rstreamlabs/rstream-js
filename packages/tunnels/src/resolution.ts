// See LICENSE file in the project root for license information.

import { authTokenSchema } from "./auth";
import { DEFAULT_API_URL } from "@rstreamlabs/rstream";
import { getTunnelsProjectEngine } from "@rstreamlabs/rstream";
import { isTokenCredentials } from "@rstreamlabs/rstream";
import { readEnvironment } from "@rstreamlabs/rstream";
import { RstreamClient } from "@rstreamlabs/rstream";
import jwt from "jsonwebtoken";
import type { RstreamCredentials } from "@rstreamlabs/rstream";

export interface TunnelsResolutionConfig {
  apiUrl?: string;
  controlPlaneCredentials?: RstreamCredentials;
  credentials?: RstreamCredentials;
  engine?: string;
  projectEndpoint?: string;
  token?: string;
}

function trimOptionalString(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function getEngineFromToken(token?: string): string | undefined {
  if (!token) {
    return undefined;
  }
  const parsed = authTokenSchema.safeParse(
    jwt.decode(token, { complete: false }),
  );
  if (!parsed.success) {
    return undefined;
  }
  return trimOptionalString(parsed.data.metadata?.engine);
}

export function resolveTunnelsAPIURL(apiUrl?: string): string {
  return (
    trimOptionalString(apiUrl) ?? readEnvironment().apiUrl ?? DEFAULT_API_URL
  );
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
  const explicitEngine = trimOptionalString(config.engine);
  if (explicitEngine) {
    return explicitEngine;
  }
  const environmentEngine = readEnvironment().engine;
  if (environmentEngine) {
    return environmentEngine;
  }
  const token =
    trimOptionalString(config.token) ??
    (isTokenCredentials(config.credentials)
      ? config.credentials.token
      : undefined);
  const tokenEngine = getEngineFromToken(token);
  if (tokenEngine) {
    return tokenEngine;
  }
  const projectEndpoint = trimOptionalString(config.projectEndpoint);
  if (projectEndpoint) {
    const credentials = resolveControlPlaneCredentials(
      config.controlPlaneCredentials,
      config.credentials,
      token,
    );
    if (credentials === undefined) {
      throw new Error(
        "Control-plane credentials are required to resolve a managed project endpoint.",
      );
    }
    const controlPlane = new RstreamClient({
      apiUrl: resolveTunnelsAPIURL(config.apiUrl),
      credentials,
    });
    const project =
      await controlPlane.tunnels.projects.resolveByEndpoint(projectEndpoint);
    const engine = getTunnelsProjectEngine(project);
    if (engine) {
      return engine;
    }
    throw new Error(
      "Failed to resolve the engine address from the managed tunnels project.",
    );
  }
  throw new Error(
    "Engine URL is not defined. Provide an engine, use RSTREAM_ENGINE, or configure a managed project endpoint with control-plane access.",
  );
}
