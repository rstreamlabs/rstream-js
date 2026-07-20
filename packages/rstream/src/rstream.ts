// See LICENSE file in the project root for license information.

import { createClientCredentialsToken } from "./auth";
import { isClientCredentials } from "./auth";
import { isTokenCredentials } from "./auth";
import { mergeControlPlaneHeaders } from "./control-plane-headers";
import { readEnvironment } from "./environment";
import { resolveAPIURL } from "./environment";
import { RstreamTunnelsResource } from "./tunnels-resource";
import { whoamiSchema } from "./whoami";
import type { RstreamCredentials } from "./auth";
import type { ControlPlaneHeaders } from "./control-plane-headers";
import type { Whoami } from "./whoami";

export interface RstreamConfig {
  credentials?: RstreamCredentials;
  apiUrl?: string;
  controlPlaneHeaders?: ControlPlaneHeaders;
}

function resolveAPIRequestURL(path: string, apiUrl: string): URL {
  const base = new URL(apiUrl);
  const trimmedPath = path.trim();
  if (!trimmedPath.startsWith("/") || trimmedPath.startsWith("//")) {
    throw new Error("API request path must be a relative absolute path.");
  }
  const url = new URL(trimmedPath, base);
  if (url.origin !== base.origin) {
    throw new Error("API request path must stay on the configured API origin.");
  }
  return url;
}

export class RstreamClient {
  private readonly config?: RstreamConfig;

  constructor(config?: RstreamConfig) {
    this.config = config;
  }

  get apiUrl(): string {
    return resolveAPIURL(this.config?.apiUrl);
  }

  get credentials(): RstreamCredentials | undefined {
    const credentials = this.config?.credentials;
    if (credentials !== undefined) {
      return credentials;
    }
    const token = readEnvironment().token;
    if (!token) {
      return undefined;
    }
    return { token };
  }

  get tunnels(): RstreamTunnelsResource {
    return new RstreamTunnelsResource(this);
  }

  async whoami(): Promise<Whoami> {
    const response = await this.request<unknown>("/api/whoami", {
      method: "GET",
    });
    return whoamiSchema.parse(response);
  }

  async getToken(): Promise<string | undefined> {
    const credentials = this.credentials;
    if (!credentials) {
      return undefined;
    }
    if (isTokenCredentials(credentials)) {
      return credentials.token;
    }
    if (isClientCredentials(credentials)) {
      return createClientCredentialsToken(credentials, {
        claims: { permissions: null },
      }).token;
    }
    return undefined;
  }

  async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = resolveAPIRequestURL(path, this.apiUrl);
    const headers = new Headers(
      mergeControlPlaneHeaders(
        readEnvironment().controlPlaneHeaders,
        this.config?.controlPlaneHeaders,
      ),
    );
    new Headers(options?.headers).forEach((value, name) =>
      headers.set(name, value),
    );
    const token = await this.getToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    const response = await fetch(url, {
      ...options,
      headers,
      redirect: "manual",
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error ${response.status}: ${errorText}`);
    }
    return await response.json();
  }
}

export { RstreamClient as Rstream };
