// See LICENSE file in the project root for license information.

import { createTURNCredentials } from "./turn";
import type { CreateTURNCredentialsOptions } from "./turn";
import type { RstreamTunnelsClient } from "./tunnels";
import type { TURNCredentials } from "@rstreamlabs/rstream";

export class RstreamTURNResource {
  private readonly client: RstreamTunnelsClient;

  constructor(client: RstreamTunnelsClient) {
    this.client = client;
  }

  async createCredentials(
    options: CreateTURNCredentialsOptions = {},
  ): Promise<TURNCredentials> {
    const engine =
      options.engine ??
      (options.clusterDomain === undefined
        ? await this.client.getEngine().catch(() => undefined)
        : undefined);
    return await createTURNCredentials({
      apiUrl: options.apiUrl ?? this.client.apiUrl,
      clusterDomain: options.clusterDomain,
      controlPlaneCredentials:
        options.controlPlaneCredentials ?? this.client.controlPlaneCredentials,
      credentials: options.credentials ?? this.client.credentials,
      engine,
      keyringBaseUrl: options.keyringBaseUrl,
      mode: options.mode,
      now: options.now,
      projectEndpoint: options.projectEndpoint ?? this.client.projectEndpoint,
      projectId: options.projectId,
      serverPublicKeyHex: options.serverPublicKeyHex,
      ttlSeconds: options.ttlSeconds,
      turnPort: options.turnPort,
      turnsPort: options.turnsPort,
    });
  }
}
