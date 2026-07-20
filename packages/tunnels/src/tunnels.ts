// See LICENSE file in the project root for license information.

import { getTunnelsProjectEngine } from "@rstreamlabs/rstream";
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

  private async getManagedProject(): Promise<TunnelsProject | undefined> {
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

  public async request<T>(path: string, options?: RequestInit): Promise<T> {
    const engine = normalizeEngineAddress(await this.getEngine());
    if (!path.startsWith("/") || path.startsWith("//")) {
      throw new Error("Engine request path must be a relative absolute path.");
    }
    const url = `https://${engine}/api${path}`;
    const headers = new Headers(options?.headers || {});
    const token = await this.getToken(engine);
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    const response = await fetch(url, {
      ...options,
      headers,
      redirect: options?.redirect ?? "manual",
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

function normalizeOptionalString(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
