// See LICENSE file in the project root for license information.

import { clientSchema } from "./client";
import { listClientsResponseSchema } from "./client";
import type { Client } from "./client";
import type { ListClientsParams } from "./client";
import type { ListClientsResponse } from "./client";
import type { RstreamTunnelsClient } from "./tunnels";

export class RstreamClientsResource {
  private readonly client: RstreamTunnelsClient;

  constructor(client: RstreamTunnelsClient) {
    this.client = client;
  }

  public async list(params?: ListClientsParams): Promise<ListClientsResponse> {
    const path =
      params === undefined
        ? "/clients"
        : `/clients?params=${encodeURIComponent(JSON.stringify(params))}`;
    const response = await this.client.request<unknown>(path, {
      method: "GET",
    });
    return listClientsResponseSchema.parse(response);
  }

  public async get(id: string): Promise<Client> {
    const response = await this.client.request<unknown>(`/clients/${id}`, {
      method: "GET",
    });
    return clientSchema.parse(response);
  }
}

export { RstreamClientsResource as RstreamClientsRessource };
