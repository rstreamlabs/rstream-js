// See LICENSE file in the project root for license information.

import { getTunnelsProjectEngine } from "@rstreamlabs/rstream";
import { createClientCredentialsToken } from "@rstreamlabs/rstream";
import { EngineHTTP } from "./engine-http";
import { hasClientCertificate } from "./engine-http";
import { isClientCredentials } from "@rstreamlabs/rstream";
import { normalizeEngineAddress } from "./resolution";
import { readEnvironment } from "@rstreamlabs/rstream";
import { resolveControlPlaneCredentials } from "./resolution";
import { resolveManagedTunnelsProject } from "./resolution";
import { resolveTunnelsAPIURL } from "./resolution";
import { resolveTunnelsCredentials } from "./resolution";
import { resolveTunnelsEngine } from "./resolution";
import { resolveTunnelsRegion } from "./resolution";
import { RstreamAuthResource } from "./auth-resource";
import { RstreamClientsResource } from "./clients-resource";
import { RstreamTunnelsResource } from "./tunnels-resource";
import { RstreamTURNResource } from "./turn-resource";
import { RstreamWebhookResource } from "./webhooks-resource";
import { RstreamWebTTYResource } from "./webtty-resource";
import type { CreateAuthTokenParams } from "@rstreamlabs/rstream/auth-token";
import type { ControlPlaneHeaders } from "@rstreamlabs/rstream";
import type { RstreamAuthTokenScopes } from "@rstreamlabs/rstream/auth-token";
import type { RstreamCredentials } from "@rstreamlabs/rstream";
import type { TunnelsProject } from "@rstreamlabs/rstream";
import type { EngineTLSOptions } from "./node-engine-http";

export interface RstreamTunnelsConfig {
  /** Node.js TLS identity and trust configuration. Treat as immutable after construction. */
  tls?: EngineTLSOptions;
  /** Explicit mTLS API override; otherwise discover once per client cache lifetime. */
  mtlsApiUrl?: string;
  /** Optional Engine-only fetch implementation. */
  fetch?: typeof globalThis.fetch;
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
   * Region selected from the endpoints authorized for the managed project.
   * Defaults to automatic project routing.
   */
  region?: string;

  /**
   * Project ID used to scope locally signed engine auth tokens.
   */
  projectId?: string;

  /**
   * Workspace ID used to scope locally signed engine auth tokens.
   */
  workspaceId?: string;

  /**
   * Control-plane credentials used when resolving a managed project endpoint.
   * Defaults to the same credentials used against the engine when available.
   */
  controlPlaneCredentials?: RstreamCredentials;

  /**
   * Additional headers sent only to the configured Control plane API.
   */
  controlPlaneHeaders?: ControlPlaneHeaders;
}

const engineAuthTokenScopes: RstreamAuthTokenScopes = {
  tunnels: {
    connect: true,
    create: true,
    list: true,
  },
};

export class RstreamTunnelsClient {
  private readonly config?: RstreamTunnelsConfig;
  private managedProject?: Promise<TunnelsProject>;
  private readonly http: EngineHTTP;

  constructor(config?: RstreamTunnelsConfig) {
    this.config = config;
    if (hasClientCertificate(config?.tls) && config?.credentials)
      throw new Error("Use a token or mTLS, not both.");
    this.http = new EngineHTTP(config ?? {});
  }

  get apiUrl(): string {
    return resolveTunnelsAPIURL(this.config?.apiUrl);
  }

  get credentials(): RstreamCredentials | undefined {
    if (this.http.usesMTLS) return undefined;
    return resolveTunnelsCredentials(this.config?.credentials);
  }

  get controlPlaneCredentials(): RstreamCredentials | undefined {
    if (this.http.usesMTLS) return undefined;
    return resolveControlPlaneCredentials(
      this.config?.controlPlaneCredentials,
      this.credentials,
    );
  }

  get controlPlaneHeaders(): ControlPlaneHeaders | undefined {
    return this.config?.controlPlaneHeaders;
  }

  get projectEndpoint(): string | undefined {
    return this.config?.projectEndpoint;
  }

  get configuredEngine(): string | undefined {
    return this.config?.engine ?? readEnvironment().engine;
  }

  get usesMTLS(): boolean {
    return this.http.usesMTLS;
  }

  async close(): Promise<void> {
    await this.http.close();
  }

  async getEngineAPIURL(signal?: AbortSignal): Promise<string> {
    return this.http.apiURL(await this.getEngine(), signal);
  }

  async getEngine(): Promise<string> {
    const region = resolveTunnelsRegion(this.config?.region);
    const projectEndpoint = normalizeOptionalString(
      this.config?.projectEndpoint,
    );
    if (region !== undefined) {
      if (
        normalizeOptionalString(this.config?.engine) !== undefined ||
        readEnvironment().engine !== undefined
      ) {
        throw new Error(
          "Region selection cannot be combined with an explicit engine override.",
        );
      }
      if (projectEndpoint === undefined) {
        throw new Error(
          "Managed project endpoint is required for region selection.",
        );
      }
      const project = await this.getManagedProject();
      if (project !== undefined) {
        const engine = getTunnelsProjectEngine(project, region);
        if (engine) return normalizeEngineAddress(engine);
      }
      throw new Error(
        "Failed to resolve the selected regional engine from the managed tunnels project.",
      );
    }
    if (
      projectEndpoint !== undefined &&
      normalizeOptionalString(this.config?.engine) === undefined &&
      readEnvironment().engine === undefined
    ) {
      const project = await this.getManagedProject();
      if (project !== undefined) {
        const engine = getTunnelsProjectEngine(project);
        if (engine) {
          return normalizeEngineAddress(engine);
        }
      }
      throw new Error(
        "Failed to resolve the engine address from the managed tunnels project.",
      );
    }
    return await resolveTunnelsEngine({
      apiUrl: this.config?.apiUrl,
      controlPlaneCredentials: this.controlPlaneCredentials,
      controlPlaneHeaders: this.config?.controlPlaneHeaders,
      credentials: this.credentials,
      engine: this.config?.engine,
      projectEndpoint: this.config?.projectEndpoint,
      region: this.config?.region,
    });
  }

  public async getTURNTarget(): Promise<{
    turnDomain: string;
    turnPort: number;
    turnRealm: string;
    turnsPort: number;
  }> {
    const project = await this.getManagedProject();
    if (project === undefined) {
      throw new Error(
        "Managed project endpoint is required to resolve the TURN target.",
      );
    }
    const turnDomain = project.turnDomain?.trim() || project.domain.trim();
    const turnRealm = project.turnRealm?.trim();
    if (!turnRealm) {
      throw new Error(
        "Managed project metadata does not expose the TURN realm; use API credential mode or provide turnRealm explicitly.",
      );
    }
    return {
      turnDomain,
      turnPort: project.turnPort,
      turnRealm,
      turnsPort: project.turnsPort,
    };
  }

  private async getManagedProject(): Promise<TunnelsProject | undefined> {
    if (this.usesMTLS)
      throw new Error(
        "mTLS project resolution requires the configured Engine address; the Control plane does not accept certificates.",
      );
    const projectEndpoint = normalizeOptionalString(
      this.config?.projectEndpoint,
    );
    if (projectEndpoint === undefined) {
      return undefined;
    }
    if (this.managedProject === undefined) {
      this.managedProject = resolveManagedTunnelsProject({
        apiUrl: this.config?.apiUrl,
        controlPlaneCredentials: this.controlPlaneCredentials,
        controlPlaneHeaders: this.config?.controlPlaneHeaders,
        credentials: this.credentials,
        projectEndpoint,
        region: this.config?.region,
      }).catch((error: unknown) => {
        this.managedProject = undefined;
        throw error;
      });
    }
    return await this.managedProject;
  }

  private async getEngineAuthTokenParams(): Promise<CreateAuthTokenParams> {
    const target = await this.getEngineAuthTokenTarget();
    return {
      resources: {
        tunnels: {
          ...target,
          scopes: engineAuthTokenScopes,
        },
      },
    };
  }

  public async getEngineAuthTokenTarget(): Promise<{
    projects?: string[];
    workspaces?: string[];
  }> {
    const projectId = normalizeOptionalString(this.config?.projectId);
    const workspaceId = normalizeOptionalString(this.config?.workspaceId);
    if (projectId !== undefined && workspaceId !== undefined) {
      throw new Error("Use either projectId or workspaceId, not both.");
    }
    if (projectId !== undefined) {
      return { projects: [projectId] };
    }
    if (workspaceId !== undefined) {
      return { workspaces: [workspaceId] };
    }
    const project = await this.getManagedProject();
    if (project !== undefined) {
      return { projects: [project.id] };
    }
    throw new Error(
      "Application credentials require projectId, workspaceId, or projectEndpoint to create scoped engine tokens.",
    );
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

  get webtty(): RstreamWebTTYResource {
    return new RstreamWebTTYResource(this);
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
    const tokenParams = await this.getEngineAuthTokenParams();
    return (
      await this.auth.createAuthToken(tokenParams, {
        credentials,
        engine,
      })
    ).token;
  }

  public async openEventStream(
    signal?: AbortSignal,
  ): Promise<{ response: Response; close(): void }> {
    const engine = await this.getEngine();
    const token = await this.getToken(engine);
    return this.http.eventStream(engine, {
      signal,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
  }

  public async request<T>(
    path: string,
    options?: RequestInit,
    maxResponseBytes?: number,
  ): Promise<T> {
    const engine = normalizeEngineAddress(await this.getEngine());
    if (!path.startsWith("/") || path.startsWith("//")) {
      throw new Error("Engine request path must be a relative absolute path.");
    }
    const headers = new Headers(options?.headers || {});
    const credentials = this.credentials;
    const token =
      path === "/turn-server/credentials" && isClientCredentials(credentials)
        ? createClientCredentialsToken(credentials, {
            expiresInSeconds: 60,
            claims: { permissions: ["turn.credentials.create"] },
          }).token
        : await this.getToken(engine);
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    const response = await this.http.response(
      engine,
      path,
      {
        ...options,
        headers,
      },
      maxResponseBytes,
    );
    return await response.json();
  }
}

export { RstreamTunnelsClient as RstreamClient };
export { RstreamTunnelsClient as Tunnels };

function normalizeOptionalString(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
