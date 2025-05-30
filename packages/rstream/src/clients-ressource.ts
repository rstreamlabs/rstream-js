// See LICENSE file in the project root for license information.

import { clientSchema } from "./client";
import { listClientsResponseSchema } from "./client";
import type { Client } from "./client";
import type { ListClientsParams } from "./client";
import type { ListClientsResponse } from "./client";
import type { RstreamClient } from "./rstream";

export class RstreamClientsRessource {
  private client: RstreamClient;

  constructor(client: RstreamClient) {
    this.client = client;
  }

  public async list(params?: ListClientsParams): Promise<ListClientsResponse> {
    const response = await this.client.request<unknown>(
      `/clients?params=${encodeURIComponent(JSON.stringify(params))}`,
      {
        method: "GET",
      },
    );
    return listClientsResponseSchema.parse(response);
  }

  public async get(id: string): Promise<Client> {
    const response = await this.client.request<unknown>(`/clients/${id}`, {
      method: "GET",
    });
    return clientSchema.parse(response);
  }
}
