// See LICENSE file in the project root for license information.

import { createTURNCredentials } from "./turn";
import { validateTURNCredentialsRequest } from "./turn";
import { requestLifetime } from "./http-lifetime";
import { waitWithSignal } from "./http-lifetime";
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
    const lifetime = requestLifetime(
      [options.signal],
      validateTURNCredentialsRequest(options),
    );
    try {
      lifetime.signal.throwIfAborted();
      return await waitWithSignal(
        this.createForLifetime({ ...options, signal: lifetime.signal }),
        lifetime.signal,
      );
    } finally {
      lifetime.close();
    }
  }

  private async createForLifetime(
    options: CreateTURNCredentialsOptions,
  ): Promise<TURNCredentials> {
    const credentials = options.credentials ?? this.client.credentials;
    const localMode = options.mode === "app" || options.mode === "pat";
    const target =
      localMode &&
      !this.client.usesMTLS &&
      (options.turnDomain === undefined || options.turnRealm === undefined) &&
      options.clusterDomain === undefined
        ? await this.client.getTURNTarget()
        : undefined;
    return await createTURNCredentials({
      client: this.client,
      signal: options.signal,
      apiUrl: options.apiUrl ?? this.client.apiUrl,
      fetch: options.fetch,
      requestTimeoutMilliseconds: options.requestTimeoutMilliseconds,
      clusterDomain: options.clusterDomain,
      controlPlaneHeaders:
        options.controlPlaneHeaders ?? this.client.controlPlaneHeaders,
      controlPlaneCredentials:
        options.controlPlaneCredentials ?? this.client.controlPlaneCredentials,
      credentials,
      engine: options.engine,
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
