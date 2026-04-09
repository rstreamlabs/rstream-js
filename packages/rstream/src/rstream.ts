// See LICENSE file in the project root for license information.

import { createClientCredentialsToken } from "./auth";
import { isClientCredentials } from "./auth";
import { isTokenCredentials } from "./auth";
import { readEnvironment } from "./environment";
import { resolveAPIURL } from "./environment";
import { RstreamTunnelsResource } from "./tunnels-resource";
import { whoamiSchema } from "./whoami";
import type { RstreamCredentials } from "./auth";
import type { Whoami } from "./whoami";

export interface RstreamConfig {
  credentials?: RstreamCredentials;
  apiUrl?: string;
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
    const url = new URL(path, this.apiUrl);
    const headers = new Headers(options?.headers);
    const token = await this.getToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    const response = await fetch(url, {
      ...options,
      headers,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error ${response.status}: ${errorText}`);
    }
    return await response.json();
  }
}

export { RstreamClient as Rstream };
