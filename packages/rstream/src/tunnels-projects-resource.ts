// See LICENSE file in the project root for license information.

import { createTunnelsWebhookParamsSchema } from "./tunnels-webhook";
import { createTurnCredentialsParamsSchema } from "./turn";
import { listTunnelsProjectEventsParamsSchema } from "./tunnels-project-event";
import { listTunnelsProjectEventsResponseSchema } from "./tunnels-project-event";
import { listTunnelsProjectsParamsSchema } from "./tunnels-project";
import { listTunnelsProjectsResponseSchema } from "./tunnels-project";
import { listTunnelsWebhookDeliveriesParamsSchema } from "./tunnels-webhook";
import { listTunnelsWebhookDeliveriesResponseSchema } from "./tunnels-webhook";
import { listTunnelsWebhooksParamsSchema } from "./tunnels-webhook";
import { listTunnelsWebhooksResponseSchema } from "./tunnels-webhook";
import { tunnelsProjectSchema } from "./tunnels-project";
import { tunnelsWebhookDeliverySchema } from "./tunnels-webhook";
import { tunnelsWebhookEndpointSchema } from "./tunnels-webhook";
import { tunnelsWebhookEndpointWithSecretSchema } from "./tunnels-webhook";
import { turnCredentialsSchema } from "./turn";
import { updateTunnelsWebhookParamsSchema } from "./tunnels-webhook";
import type { CreateTunnelsWebhookParams } from "./tunnels-webhook";
import type { CreateTurnCredentialsParams } from "./turn";
import type { ListTunnelsProjectEventsParams } from "./tunnels-project-event";
import type { ListTunnelsProjectEventsResponse } from "./tunnels-project-event";
import type { ListTunnelsProjectsParams } from "./tunnels-project";
import type { ListTunnelsProjectsResponse } from "./tunnels-project";
import type { ListTunnelsWebhookDeliveriesParams } from "./tunnels-webhook";
import type { ListTunnelsWebhookDeliveriesResponse } from "./tunnels-webhook";
import type { ListTunnelsWebhooksParams } from "./tunnels-webhook";
import type { ListTunnelsWebhooksResponse } from "./tunnels-webhook";
import type { RstreamClient } from "./rstream";
import type { TunnelsProject } from "./tunnels-project";
import type { TunnelsWebhookDelivery } from "./tunnels-webhook";
import type { TunnelsWebhookEndpoint } from "./tunnels-webhook";
import type { TunnelsWebhookEndpointWithSecret } from "./tunnels-webhook";
import type { TURNCredentials } from "./turn";
import type { UpdateTunnelsWebhookParams } from "./tunnels-webhook";

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

function appendSearchParam(
  searchParams: URLSearchParams,
  key: string,
  value: number | string | undefined,
) {
  if (value !== undefined) searchParams.set(key, String(value));
}

function pathIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return encodeURIComponent(normalized);
}

function projectPath(projectId: string, suffix: string): string {
  return `/api/projects/tunnels/${pathIdentifier(projectId, "Project ID")}${suffix}`;
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

  async listEvents(
    projectId: string,
    params?: ListTunnelsProjectEventsParams,
  ): Promise<ListTunnelsProjectEventsResponse> {
    const parsed = listTunnelsProjectEventsParamsSchema.parse(params ?? {});
    const searchParams = new URLSearchParams();
    appendSearchParam(searchParams, "timeline", parsed.timeline);
    appendSearchParam(searchParams, "start", parsed.start);
    appendSearchParam(searchParams, "end", parsed.end);
    appendSearchParam(searchParams, "eventType", parsed.eventType);
    appendSearchParam(searchParams, "afterEventId", parsed.afterEventId);
    appendSearchParam(searchParams, "page", parsed.page);
    appendSearchParam(searchParams, "pageSize", parsed.pageSize);
    appendSearchParam(searchParams, "order", parsed.order);
    const suffix =
      searchParams.size > 0 ? `/events?${searchParams.toString()}` : "/events";
    const response = await this.client.request<unknown>(
      projectPath(projectId, suffix),
      { method: "GET" },
    );
    return listTunnelsProjectEventsResponseSchema.parse(response);
  }

  async listWebhooks(
    projectId: string,
    params?: ListTunnelsWebhooksParams,
  ): Promise<ListTunnelsWebhooksResponse> {
    const parsed = listTunnelsWebhooksParamsSchema.parse(params ?? {});
    const searchParams = new URLSearchParams();
    appendSearchParam(searchParams, "q", parsed.q);
    appendSearchParam(searchParams, "status", parsed.status);
    appendSearchParam(searchParams, "destinationType", parsed.destinationType);
    appendSearchParam(searchParams, "page", parsed.page);
    appendSearchParam(searchParams, "pageSize", parsed.pageSize);
    appendSearchParam(searchParams, "sort", parsed.sort);
    appendSearchParam(searchParams, "order", parsed.order);
    const suffix =
      searchParams.size > 0
        ? `/webhooks?${searchParams.toString()}`
        : "/webhooks";
    const response = await this.client.request<unknown>(
      projectPath(projectId, suffix),
      { method: "GET" },
    );
    return listTunnelsWebhooksResponseSchema.parse(response);
  }

  async createWebhook(
    projectId: string,
    params: CreateTunnelsWebhookParams,
  ): Promise<TunnelsWebhookEndpointWithSecret> {
    const parsed = createTunnelsWebhookParamsSchema.parse(params);
    const response = await this.client.request<unknown>(
      projectPath(projectId, "/webhooks"),
      {
        body: JSON.stringify(parsed),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    return tunnelsWebhookEndpointWithSecretSchema.parse(response);
  }

  async getWebhook(
    projectId: string,
    webhookId: string,
  ): Promise<TunnelsWebhookEndpoint> {
    const response = await this.client.request<unknown>(
      projectPath(
        projectId,
        `/webhooks/${pathIdentifier(webhookId, "Webhook ID")}`,
      ),
      { method: "GET" },
    );
    return tunnelsWebhookEndpointSchema.parse(response);
  }

  async updateWebhook(
    projectId: string,
    webhookId: string,
    params: UpdateTunnelsWebhookParams,
  ): Promise<TunnelsWebhookEndpoint> {
    const parsed = updateTunnelsWebhookParamsSchema.parse(params);
    const response = await this.client.request<unknown>(
      projectPath(
        projectId,
        `/webhooks/${pathIdentifier(webhookId, "Webhook ID")}`,
      ),
      {
        body: JSON.stringify(parsed),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      },
    );
    return tunnelsWebhookEndpointSchema.parse(response);
  }

  async deleteWebhook(
    projectId: string,
    webhookId: string,
  ): Promise<TunnelsWebhookEndpoint> {
    const response = await this.client.request<unknown>(
      projectPath(
        projectId,
        `/webhooks/${pathIdentifier(webhookId, "Webhook ID")}`,
      ),
      { method: "DELETE" },
    );
    return tunnelsWebhookEndpointSchema.parse(response);
  }

  async rotateWebhookSecret(
    projectId: string,
    webhookId: string,
  ): Promise<TunnelsWebhookEndpointWithSecret> {
    const response = await this.client.request<unknown>(
      projectPath(
        projectId,
        `/webhooks/${pathIdentifier(webhookId, "Webhook ID")}/secret/rotate`,
      ),
      { method: "POST" },
    );
    return tunnelsWebhookEndpointWithSecretSchema.parse(response);
  }

  async listWebhookDeliveries(
    projectId: string,
    webhookId: string,
    params?: ListTunnelsWebhookDeliveriesParams,
  ): Promise<ListTunnelsWebhookDeliveriesResponse> {
    const parsed = listTunnelsWebhookDeliveriesParamsSchema.parse(params ?? {});
    const searchParams = new URLSearchParams();
    appendSearchParam(searchParams, "status", parsed.status);
    appendSearchParam(searchParams, "eventType", parsed.eventType);
    appendSearchParam(searchParams, "start", parsed.start);
    appendSearchParam(searchParams, "end", parsed.end);
    appendSearchParam(searchParams, "page", parsed.page);
    appendSearchParam(searchParams, "pageSize", parsed.pageSize);
    appendSearchParam(searchParams, "order", parsed.order);
    const query = searchParams.size > 0 ? `?${searchParams.toString()}` : "";
    const response = await this.client.request<unknown>(
      projectPath(
        projectId,
        `/webhooks/${pathIdentifier(webhookId, "Webhook ID")}/deliveries${query}`,
      ),
      { method: "GET" },
    );
    return listTunnelsWebhookDeliveriesResponseSchema.parse(response);
  }

  async getWebhookDelivery(
    projectId: string,
    webhookId: string,
    deliveryId: string,
  ): Promise<TunnelsWebhookDelivery> {
    const response = await this.client.request<unknown>(
      projectPath(
        projectId,
        `/webhooks/${pathIdentifier(webhookId, "Webhook ID")}/deliveries/${pathIdentifier(deliveryId, "Delivery ID")}`,
      ),
      { method: "GET" },
    );
    return tunnelsWebhookDeliverySchema.parse(response);
  }
}
