// See LICENSE file in the project root for license information.

import { listTunnelsResponseSchema } from "./tunnel";
import { tunnelSchema } from "./tunnel";
import type { ListTunnelsParams } from "./tunnel";
import type { ListTunnelsResponse } from "./tunnel";
import type { RstreamClient } from "./rstream";
import type { Tunnel } from "./tunnel";

export class RstreamTunnelsRessource {
  private client: RstreamClient;

  constructor(client: RstreamClient) {
    this.client = client;
  }

  public async list(params?: ListTunnelsParams): Promise<ListTunnelsResponse> {
    const response = await this.client.request<unknown>(
      `/tunnels?params=${encodeURIComponent(JSON.stringify(params))}`,
      {
        method: "GET",
      },
    );
    return listTunnelsResponseSchema.parse(response);
  }

  public async get(id: string): Promise<Tunnel> {
    const response = await this.client.request<unknown>(`/tunnels/${id}`, {
      method: "GET",
    });
    return tunnelSchema.parse(response);
  }
}
