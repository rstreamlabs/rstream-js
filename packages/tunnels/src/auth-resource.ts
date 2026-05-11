// See LICENSE file in the project root for license information.

import { createClientCredentialsToken } from "@rstreamlabs/rstream";
import { createAuthTokenParamsSchema } from "./auth";
import { isClientCredentials } from "@rstreamlabs/rstream";
import type { ClientCredentials } from "@rstreamlabs/rstream";
import type { CreateAuthTokenParams } from "./auth";
import type { CreateAuthTokenResponse } from "./auth";
import type { ParsedCreateAuthTokenParams } from "./auth";
import type { RstreamAuthJwtPayload } from "./auth";
import type { RstreamAuthTokenTunnelGrant } from "./auth";
import type { RstreamTunnelsClient } from "./tunnels";

export interface CreateAuthTokenFromClientCredentialsOptions {
  engine?: string;
  projectId?: string;
  workspaceId?: string;
}

export class RstreamAuthResource {
  private readonly client: RstreamTunnelsClient;

  constructor(client: RstreamTunnelsClient) {
    this.client = client;
  }

  async createAuthToken(
    params: CreateAuthTokenParams,
    options?: CreateAuthTokenFromClientCredentialsOptions & {
      credentials?: ClientCredentials;
    },
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
  params: CreateAuthTokenParams,
  options?: CreateAuthTokenFromClientCredentialsOptions,
): CreateAuthTokenResponse {
  const tokenParams = createAuthTokenParamsSchema.parse(params);
  const payload: Omit<
    RstreamAuthJwtPayload,
    "clientId" | "exp" | "iat" | "type"
  > = {
    metadata: {
      engine: options?.engine,
    },
    tunnelsGrants: normalizeAuthTokenTunnelGrants(tokenParams, options),
    permissions: null,
  };
  const { token } = createClientCredentialsToken(credentials, {
    claims: payload,
    expiresInSeconds: tokenParams.expires_in,
  });
  return { token };
}

function normalizeAuthTokenTunnelGrants(
  params: ParsedCreateAuthTokenParams,
  options?: CreateAuthTokenFromClientCredentialsOptions,
): RstreamAuthTokenTunnelGrant[] | undefined {
  const tunnelsGrants = params.tunnelsGrants;
  if (tunnelsGrants !== undefined) {
    return [...tunnelsGrants];
  }
  if (params.scopes) {
    return [{ ...normalizeTunnelGrantTarget(options), scopes: params.scopes }];
  }
  return undefined;
}

function normalizeTunnelGrantTarget(
  options?: CreateAuthTokenFromClientCredentialsOptions,
): Pick<RstreamAuthTokenTunnelGrant, "projects" | "workspaces"> {
  const projectId = normalizeOptionalString(options?.projectId);
  const workspaceId = normalizeOptionalString(options?.workspaceId);
  if (projectId !== undefined && workspaceId !== undefined) {
    throw new Error("Use either projectId or workspaceId, not both.");
  }
  if (projectId !== undefined) {
    return { projects: [projectId] };
  }
  if (workspaceId !== undefined) {
    return { workspaces: [workspaceId] };
  }
  throw new Error(
    "Project ID or workspace ID is required when using scope-only tunnel grants.",
  );
}

function normalizeOptionalString(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export { RstreamAuthResource as RstreamAuthRessource };
