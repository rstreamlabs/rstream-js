// See LICENSE file in the project root for license information.

import { listTunnelsResponseSchema } from "./tunnel";
import { tunnelSchema } from "./tunnel";
import type { ListTunnelsParams } from "./tunnel";
import type { ListTunnelsResponse } from "./tunnel";
import type { RstreamTunnelsClient } from "./tunnels";
import type { Tunnel } from "./tunnel";

function tunnelPathId(id: string): string {
  const normalized = id.trim();
  if (!normalized) {
    throw new Error("Tunnel ID is required.");
  }
  return encodeURIComponent(normalized);
}

export class RstreamTunnelsResource {
  private readonly client: RstreamTunnelsClient;

  constructor(client: RstreamTunnelsClient) {
    this.client = client;
  }

  public async list(params?: ListTunnelsParams): Promise<ListTunnelsResponse> {
    const path =
      params === undefined
        ? "/tunnels"
        : `/tunnels?params=${encodeURIComponent(JSON.stringify(params))}`;
    const response = await this.client.request<unknown>(path, {
      method: "GET",
    });
    return listTunnelsResponseSchema.parse(response);
  }

  public async get(id: string): Promise<Tunnel> {
    const response = await this.client.request<unknown>(
      `/tunnels/${tunnelPathId(id)}`,
      {
        method: "GET",
      },
    );
    return tunnelSchema.parse(response);
  }
}

export { RstreamTunnelsResource as RstreamTunnelsRessource };
