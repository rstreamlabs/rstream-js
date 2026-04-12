// See LICENSE file in the project root for license information.

import { createClientCredentialsToken } from "@rstreamlabs/rstream";
import { createAuthTokenParamsSchema } from "./auth";
import { isClientCredentials } from "@rstreamlabs/rstream";
import type { ClientCredentials } from "@rstreamlabs/rstream";
import type { CreateAuthTokenParams } from "./auth";
import type { CreateAuthTokenResponse } from "./auth";
import type { RstreamAuthJwtPayload } from "./auth";
import type { RstreamAuthTokenTunnelGrant } from "./auth";
import type { RstreamTunnelsClient } from "./tunnels";

export class RstreamAuthResource {
  private readonly client: RstreamTunnelsClient;

  constructor(client: RstreamTunnelsClient) {
    this.client = client;
  }

  async createAuthToken(
    params?: CreateAuthTokenParams,
    options?: { credentials?: ClientCredentials; engine?: string },
  ): Promise<CreateAuthTokenResponse> {
    const credentials = options?.credentials || this.client.credentials;
    if (!isClientCredentials(credentials)) {
      throw new Error(
        "Application credentials (client id, client secret) are required to create an auth token.",
      );
    }
    const engine =
      options?.engine ?? (await this.client.getEngine().catch(() => undefined));
    return createAuthTokenFromClientCredentials(credentials, params, {
      engine,
    });
  }
}

export function createAuthTokenFromClientCredentials(
  credentials: ClientCredentials,
  params?: CreateAuthTokenParams,
  options?: { engine?: string },
): CreateAuthTokenResponse {
  const tokenParams = createAuthTokenParamsSchema.parse(params ?? {});
  const payload: Omit<
    RstreamAuthJwtPayload,
    "clientId" | "exp" | "iat" | "type"
  > = {
    metadata: {
      engine: options?.engine,
    },
    tunnelsGrants: normalizeAuthTokenTunnelGrants(tokenParams),
    permissions: null,
  };
  const { token } = createClientCredentialsToken(credentials, {
    claims: payload,
    expiresInSeconds: tokenParams.expires_in,
  });
  return { token };
}

function normalizeAuthTokenTunnelGrants(
  params?: CreateAuthTokenParams,
): RstreamAuthTokenTunnelGrant[] | undefined {
  if (!params) {
    return undefined;
  }
  const tunnelsGrants = params.tunnelsGrants;
  if (tunnelsGrants !== undefined) {
    return [...tunnelsGrants];
  }
  if (params.scopes) {
    return [{ scopes: params.scopes }];
  }
  return undefined;
}

export { RstreamAuthResource as RstreamAuthRessource };
