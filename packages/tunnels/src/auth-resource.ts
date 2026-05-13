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

type AuthTokenTunnelGrantTarget = {
  projects?: string[];
  workspaces?: string[];
};

export interface CreateAuthTokenFromClientCredentialsOptions {
  engine?: string;
  projectScoped?: boolean;
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
    const scopedOptions = await this.resolveScopeOptions(params, options);
    return createAuthTokenFromClientCredentials(credentials, params, {
      engine,
      ...scopedOptions,
    });
  }

  private async resolveScopeOptions(
    params: CreateAuthTokenParams,
    options?: CreateAuthTokenFromClientCredentialsOptions,
  ): Promise<CreateAuthTokenFromClientCredentialsOptions> {
    const tokenParams = createAuthTokenParamsSchema.parse(params);
    if (options?.projectScoped === false) {
      return options ?? {};
    }
    if (
      options?.projectId !== undefined ||
      options?.workspaceId !== undefined
    ) {
      return options;
    }
    if (
      tokenParams.scopes === undefined &&
      !tunnelGrantsNeedDefaultTarget(tokenParams.tunnelsGrants)
    ) {
      return options ?? {};
    }
    const target = await this.client.getEngineAuthTokenTarget();
    return {
      ...options,
      projectId: target.projects?.[0],
      workspaceId: target.workspaces?.[0],
    };
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
): RstreamAuthTokenTunnelGrant | undefined {
  const tunnelsGrants = params.tunnelsGrants;
  if (tunnelsGrants !== undefined) {
    return applyDefaultTunnelGrantTarget(tunnelsGrants, options);
  }
  if (params.scopes) {
    return { ...normalizeTunnelGrantTarget(options), scopes: params.scopes };
  }
  return undefined;
}

function applyDefaultTunnelGrantTarget(
  grants: RstreamAuthTokenTunnelGrant,
  options?: CreateAuthTokenFromClientCredentialsOptions,
  inheritedTarget = false,
): RstreamAuthTokenTunnelGrant {
  if (options?.projectScoped === false) {
    return grants;
  }
  if ("AND" in grants) {
    const branchHasTarget =
      inheritedTarget ||
      grants.AND.some((grant) => tunnelGrantTreeHasTarget(grant));
    return {
      AND: grants.AND.map((grant) =>
        applyDefaultTunnelGrantTarget(grant, options, branchHasTarget),
      ),
    };
  }
  if ("OR" in grants) {
    return {
      OR: grants.OR.map((grant) =>
        applyDefaultTunnelGrantTarget(grant, options, inheritedTarget),
      ),
    };
  }
  if (
    grants.scopes === undefined ||
    tunnelGrantHasTarget(grants) ||
    inheritedTarget
  ) {
    return grants;
  }
  return { ...normalizeTunnelGrantTarget(options), scopes: grants.scopes };
}

function tunnelGrantsNeedDefaultTarget(
  grants?: RstreamAuthTokenTunnelGrant,
  inheritedTarget = false,
): boolean {
  if (grants === undefined) {
    return false;
  }
  if ("AND" in grants) {
    const branchHasTarget =
      inheritedTarget ||
      grants.AND.some((grant) => tunnelGrantTreeHasTarget(grant));
    return grants.AND.some((grant) =>
      tunnelGrantsNeedDefaultTarget(grant, branchHasTarget),
    );
  }
  if ("OR" in grants) {
    return grants.OR.some((grant) =>
      tunnelGrantsNeedDefaultTarget(grant, inheritedTarget),
    );
  }
  return (
    grants.scopes !== undefined &&
    !tunnelGrantHasTarget(grants) &&
    !inheritedTarget
  );
}

function tunnelGrantHasTarget(grant: AuthTokenTunnelGrantTarget): boolean {
  return grant.projects !== undefined || grant.workspaces !== undefined;
}

function tunnelGrantTreeHasTarget(
  grants: RstreamAuthTokenTunnelGrant,
): boolean {
  if ("AND" in grants) {
    return grants.AND.some((grant) => tunnelGrantTreeHasTarget(grant));
  }
  if ("OR" in grants) {
    return grants.OR.some((grant) => tunnelGrantTreeHasTarget(grant));
  }
  return tunnelGrantHasTarget(grants);
}

function normalizeTunnelGrantTarget(
  options?: CreateAuthTokenFromClientCredentialsOptions,
): AuthTokenTunnelGrantTarget {
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
  if (options?.projectScoped === false) {
    return {};
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
