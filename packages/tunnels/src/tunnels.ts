// See LICENSE file in the project root for license information.

import { isClientCredentials } from "@rstreamlabs/rstream";
import { resolveControlPlaneCredentials } from "./resolution";
import { resolveTunnelsAPIURL } from "./resolution";
import { resolveTunnelsCredentials } from "./resolution";
import { resolveTunnelsEngine } from "./resolution";
import { RstreamAuthResource } from "./auth-resource";
import { RstreamClientsResource } from "./clients-resource";
import { RstreamTunnelsResource } from "./tunnels-resource";
import { RstreamTURNResource } from "./turn-resource";
import { RstreamWebhookResource } from "./webhooks-resource";
import type { RstreamCredentials } from "@rstreamlabs/rstream";

export interface RstreamTunnelsConfig {
  /**
   * Data-plane credentials used against the engine.
   */
  credentials?: RstreamCredentials;

  /**
   * Engine URL to connect to. (e.g. "project-endpoint.cluster.example.rstream.test:443").
   */
  engine?: string;

  /**
   * Control-plane API URL used to resolve a managed project endpoint.
   * Defaults to https://rstream.io.
   */
  apiUrl?: string;

  /**
   * Managed tunnels project endpoint.
   * Used when the engine is not set explicitly.
   */
  projectEndpoint?: string;

  /**
   * Control-plane credentials used when resolving a managed project endpoint.
   * Defaults to the same credentials used against the engine when available.
   */
  controlPlaneCredentials?: RstreamCredentials;
}

export class RstreamTunnelsClient {
  private readonly config?: RstreamTunnelsConfig;

  constructor(config?: RstreamTunnelsConfig) {
    this.config = config;
  }

  get apiUrl(): string {
    return resolveTunnelsAPIURL(this.config?.apiUrl);
  }

  get credentials(): RstreamCredentials | undefined {
    return resolveTunnelsCredentials(this.config?.credentials);
  }

  get controlPlaneCredentials(): RstreamCredentials | undefined {
    return resolveControlPlaneCredentials(
      this.config?.controlPlaneCredentials,
      this.credentials,
    );
  }

  get projectEndpoint(): string | undefined {
    return this.config?.projectEndpoint;
  }

  async getEngine(): Promise<string> {
    return await resolveTunnelsEngine({
      apiUrl: this.config?.apiUrl,
      controlPlaneCredentials: this.controlPlaneCredentials,
      credentials: this.credentials,
      engine: this.config?.engine,
      projectEndpoint: this.config?.projectEndpoint,
    });
  }

  get auth(): RstreamAuthResource {
    return new RstreamAuthResource(this);
  }

  get clients(): RstreamClientsResource {
    return new RstreamClientsResource(this);
  }

  get tunnels(): RstreamTunnelsResource {
    return new RstreamTunnelsResource(this);
  }

  get webhooks(): RstreamWebhookResource {
    return new RstreamWebhookResource();
  }

  get turn(): RstreamTURNResource {
    return new RstreamTURNResource(this);
  }

  public async getToken(engine?: string): Promise<string | undefined> {
    const credentials = this.credentials;
    if (!credentials) {
      return undefined;
    }
    if (!isClientCredentials(credentials)) {
      return credentials.token;
    }
    return (
      await this.auth.createAuthToken(undefined, {
        credentials,
        engine,
      })
    ).token;
  }

  public async request<T>(path: string, options?: RequestInit): Promise<T> {
    const engine = await this.getEngine();
    const url = `https://${engine}/api${path}`;
    const headers = new Headers(options?.headers || {});
    const token = await this.getToken(engine);
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

export { RstreamTunnelsClient as RstreamClient };
export { RstreamTunnelsClient as Tunnels };
