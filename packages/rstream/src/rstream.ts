// See LICENSE file in the project root for license information.

import { RstreamAuthRessource } from "./auth-ressource";
import { RstreamClientsRessource } from "./clients-ressource";
import { RstreamTunnelsRessource } from "./tunnels-ressource";
import { RstreamWebHooksRessource } from "./webhooks-ressource";

export interface RstreamConfig {
  /**
   * The credentials authenticate with the API.
   */
  credentials?:
    | {
        /**
         * Authentication token (long-lived).
         */
        token: string;
      }
    | {
        /**
         * Client ID.
         */
        clientId: string;

        /**
         * Client secret.
         */
        clientSecret: string;
      };

  /**
   * Engine URL to connect to. (e.g. "eed433ec.aws-eu-west-3-1.c.rstream.io:8443:443").
   */
  engine?: string;
}

export class RstreamClient {
  private cfg?: RstreamConfig;

  constructor(config?: RstreamConfig) {
    this.cfg = config;
  }

  get engine() {
    if (this.cfg?.engine) {
      return this.cfg.engine;
    }
    if (process.env.RSTREAM_DEFAULT_ENGINE) {
      return process.env.RSTREAM_DEFAULT_ENGINE;
    }
    return undefined;
  }

  get credentials() {
    if (this.cfg?.credentials && "token" in this.cfg.credentials) {
      return this.cfg.credentials;
    }
    if (process.env.RSTREAM_DEFAULT_AUTHENTICATION_TOKEN) {
      return {
        token: process.env.RSTREAM_DEFAULT_AUTHENTICATION_TOKEN,
      };
    }
    if (this.cfg?.credentials && "clientId" in this.cfg.credentials) {
      return this.cfg.credentials;
    }
    if (
      process.env.RSTREAM_DEFAULT_CLIENT_ID &&
      process.env.RSTREAM_DEFAULT_CLIENT_SECRET
    ) {
      return {
        clientId: process.env.RSTREAM_DEFAULT_CLIENT_ID,
        clientSecret: process.env.RSTREAM_DEFAULT_CLIENT_SECRET,
      };
    }
    return undefined;
  }

  get api() {
    const engine = this.engine;
    if (!engine) {
      throw new Error(
        "Engine URL is not defined. Please provide an engine in the rstream client configuration or set the RSTREAM_DEFAULT_ENGINE environment variable.",
      );
    }
    return `https://${engine}/api`;
  }

  get auth(): RstreamAuthRessource {
    return new RstreamAuthRessource(this);
  }

  get clients(): RstreamClientsRessource {
    return new RstreamClientsRessource(this);
  }

  get tunnels(): RstreamTunnelsRessource {
    return new RstreamTunnelsRessource(this);
  }

  get webhooks(): RstreamWebHooksRessource {
    return new RstreamWebHooksRessource(this);
  }

  public async getToken(): Promise<string | undefined> {
    const credentials = this.credentials;
    if (credentials && "token" in credentials) {
      return credentials.token;
    }
    if (credentials && "clientId" in credentials) {
      return (
        await this.auth.createAuthToken(undefined, {
          credentials: {
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
          },
        })
      ).token;
    }
    return undefined;
  }

  public async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.api}${path}`;
    const headers = new Headers(options?.headers || {});
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
