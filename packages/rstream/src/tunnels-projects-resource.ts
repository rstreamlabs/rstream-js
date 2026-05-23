// See LICENSE file in the project root for license information.

import { createTurnCredentialsParamsSchema } from "./turn";
import { listTunnelsProjectsParamsSchema } from "./tunnels-project";
import { listTunnelsProjectsResponseSchema } from "./tunnels-project";
import { tunnelsProjectSchema } from "./tunnels-project";
import { turnCredentialsSchema } from "./turn";
import type { CreateTurnCredentialsParams } from "./turn";
import type { ListTunnelsProjectsParams } from "./tunnels-project";
import type { ListTunnelsProjectsResponse } from "./tunnels-project";
import type { RstreamClient } from "./rstream";
import type { TunnelsProject } from "./tunnels-project";
import type { TURNCredentials } from "./turn";

function createTurnCredentialsRequestInit(
  params: CreateTurnCredentialsParams,
): RequestInit {
  return params.ttlSeconds === undefined
    ? { method: "POST" }
    : {
        body: JSON.stringify({ ttlSeconds: params.ttlSeconds }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      };
}

export class RstreamTunnelsProjectsResource {
  private readonly client: RstreamClient;

  constructor(client: RstreamClient) {
    this.client = client;
  }

  async list(
    params?: ListTunnelsProjectsParams,
  ): Promise<ListTunnelsProjectsResponse> {
    const parsed = listTunnelsProjectsParamsSchema.parse(params ?? {});
    const searchParams = new URLSearchParams();
    if (parsed.q !== undefined) {
      searchParams.set("q", parsed.q);
    }
    if (parsed.page !== undefined) {
      searchParams.set("page", String(parsed.page));
    }
    if (parsed.pageSize !== undefined) {
      searchParams.set("pageSize", String(parsed.pageSize));
    }
    if (parsed.sort !== undefined) {
      searchParams.set("sort", parsed.sort);
    }
    if (parsed.order !== undefined) {
      searchParams.set("order", parsed.order);
    }
    const path =
      searchParams.size > 0
        ? `/api/projects/tunnels?${searchParams.toString()}`
        : "/api/projects/tunnels";
    const response = await this.client.request<unknown>(path, {
      method: "GET",
    });
    return listTunnelsProjectsResponseSchema.parse(response);
  }

  async resolveByEndpoint(endpoint: string): Promise<TunnelsProject> {
    const normalizedEndpoint = endpoint.trim();
    if (!normalizedEndpoint) {
      throw new Error("Project endpoint is required.");
    }
    const response = await this.client.request<unknown>(
      `/api/projects/tunnels/resolve/${encodeURIComponent(normalizedEndpoint)}`,
      {
        method: "GET",
      },
    );
    return tunnelsProjectSchema.parse(response);
  }

  async createTurnCredentials(
    projectId: string,
    params?: CreateTurnCredentialsParams,
  ): Promise<TURNCredentials> {
    const normalizedProjectId = projectId.trim();
    if (!normalizedProjectId) {
      throw new Error("Project ID is required.");
    }
    const parsed = createTurnCredentialsParamsSchema.parse(params ?? {});
    const response = await this.client.request<unknown>(
      `/api/projects/tunnels/${encodeURIComponent(normalizedProjectId)}/turn-server/credentials`,
      createTurnCredentialsRequestInit(parsed),
    );
    return turnCredentialsSchema.parse(response);
  }

  async createTurnCredentialsByEndpoint(
    endpoint: string,
    params?: CreateTurnCredentialsParams,
  ): Promise<TURNCredentials> {
    const normalizedEndpoint = endpoint.trim();
    if (!normalizedEndpoint) {
      throw new Error("Project endpoint is required.");
    }
    const parsed = createTurnCredentialsParamsSchema.parse(params ?? {});
    const response = await this.client.request<unknown>(
      `/api/projects/tunnels/resolve/${encodeURIComponent(normalizedEndpoint)}/turn-server/credentials`,
      createTurnCredentialsRequestInit(parsed),
    );
    return turnCredentialsSchema.parse(response);
  }
}
