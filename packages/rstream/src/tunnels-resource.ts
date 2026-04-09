// See LICENSE file in the project root for license information.

import { RstreamTunnelsProjectsResource } from "./tunnels-projects-resource";
import type { RstreamClient } from "./rstream";

export class RstreamTunnelsResource {
  private readonly client: RstreamClient;

  constructor(client: RstreamClient) {
    this.client = client;
  }

  get projects(): RstreamTunnelsProjectsResource {
    return new RstreamTunnelsProjectsResource(this.client);
  }
}
