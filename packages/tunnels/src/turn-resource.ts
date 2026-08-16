// See LICENSE file in the project root for license information.

import { createTURNCredentials } from "./turn";
import { isClientCredentials } from "@rstreamlabs/rstream";
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
    const credentials = options.credentials ?? this.client.credentials;
    const localMode =
      options.mode === "app" ||
      options.mode === "pat" ||
      (options.mode === undefined && isClientCredentials(credentials));
    const target =
      localMode &&
      (options.turnDomain === undefined || options.turnRealm === undefined) &&
      options.clusterDomain === undefined
        ? await this.client.getTURNTarget()
        : undefined;
    const engine =
      options.engine ??
      (options.clusterDomain === undefined &&
      options.turnDomain === undefined &&
      target === undefined
        ? await this.client.getEngine().catch(() => undefined)
        : undefined);
    return await createTURNCredentials({
      apiUrl: options.apiUrl ?? this.client.apiUrl,
      clusterDomain: options.clusterDomain,
      controlPlaneCredentials:
        options.controlPlaneCredentials ?? this.client.controlPlaneCredentials,
      credentials,
      engine,
      keyringBaseUrl: options.keyringBaseUrl,
      mode: options.mode,
      now: options.now,
      projectEndpoint: options.projectEndpoint ?? this.client.projectEndpoint,
      projectId: options.projectId,
      serverPublicKeyHex: options.serverPublicKeyHex,
      tokenEndpoint: options.tokenEndpoint,
      ttlSeconds: options.ttlSeconds,
      turnDomain: options.turnDomain ?? target?.turnDomain,
      turnPort: options.turnPort ?? target?.turnPort,
      turnRealm: options.turnRealm ?? target?.turnRealm,
      turnsPort: options.turnsPort ?? target?.turnsPort,
    });
  }
}
