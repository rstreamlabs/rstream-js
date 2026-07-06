// See LICENSE file in the project root for license information.

import { createAuthTokenParamsSchema } from "@rstreamlabs/rstream/auth-token";
import { createClientCredentialsToken } from "@rstreamlabs/rstream";
import { isClientCredentials } from "@rstreamlabs/rstream";
import type { ClientCredentials } from "@rstreamlabs/rstream";
import type { CreateAuthTokenParams } from "@rstreamlabs/rstream/auth-token";
import type { CreateAuthTokenResponse } from "@rstreamlabs/rstream/auth-token";
import type { ParsedCreateAuthTokenParams } from "@rstreamlabs/rstream/auth-token";
import type { RstreamAuthJwtPayload } from "@rstreamlabs/rstream/auth-token";
import type { RstreamAuthTokenResources } from "@rstreamlabs/rstream/auth-token";
import type { RstreamAuthTokenTunnelResource } from "@rstreamlabs/rstream/auth-token";
import type { RstreamTunnelsClient } from "./tunnels";

type AuthTokenTunnelResourceTarget = {
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
    if (!tunnelResourcesNeedDefaultTarget(tokenParams.resources?.tunnels)) {
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
    permissions: tokenParams.permissions ?? null,
    resources: normalizeAuthTokenResources(tokenParams, options),
  };
  const { token } = createClientCredentialsToken(credentials, {
    claims: payload,
    expiresInSeconds: tokenParams.expires_in,
  });
  return { token };
}

function normalizeAuthTokenResources(
  params: ParsedCreateAuthTokenParams,
  options?: CreateAuthTokenFromClientCredentialsOptions,
): RstreamAuthTokenResources {
  return {
    tunnels: applyDefaultTunnelResourceTarget(
      requireTunnelResource(params),
      options,
    ),
  };
}

function requireTunnelResource(
  params: ParsedCreateAuthTokenParams,
): RstreamAuthTokenTunnelResource {
  const tunnels = params.resources?.tunnels;
  if (tunnels !== undefined) return tunnels;
  throw new Error("Explicit resources.tunnels is required.");
}

function applyDefaultTunnelResourceTarget(
  resource: RstreamAuthTokenTunnelResource,
  options?: CreateAuthTokenFromClientCredentialsOptions,
  inheritedTarget = false,
): RstreamAuthTokenTunnelResource {
  if (options?.projectScoped === false) {
    return resource;
  }
  if ("AND" in resource) {
    const branchHasTarget =
      inheritedTarget ||
      resource.AND.some((child) => tunnelResourceTreeHasTarget(child));
    return {
      AND: resource.AND.map((child) =>
        applyDefaultTunnelResourceTarget(child, options, branchHasTarget),
      ),
    };
  }
  if ("OR" in resource) {
    return {
      OR: resource.OR.map((child) =>
        applyDefaultTunnelResourceTarget(child, options, inheritedTarget),
      ),
    };
  }
  if (
    resource.scopes === undefined ||
    tunnelResourceHasTarget(resource) ||
    inheritedTarget
  ) {
    return resource;
  }
  return { ...normalizeTunnelResourceTarget(options), scopes: resource.scopes };
}

function tunnelResourcesNeedDefaultTarget(
  resource?: RstreamAuthTokenTunnelResource,
  inheritedTarget = false,
): boolean {
  if (resource === undefined) {
    return false;
  }
  if ("AND" in resource) {
    const branchHasTarget =
      inheritedTarget ||
      resource.AND.some((child) => tunnelResourceTreeHasTarget(child));
    return resource.AND.some((child) =>
      tunnelResourcesNeedDefaultTarget(child, branchHasTarget),
    );
  }
  if ("OR" in resource) {
    return resource.OR.some((child) =>
      tunnelResourcesNeedDefaultTarget(child, inheritedTarget),
    );
  }
  return (
    resource.scopes !== undefined &&
    !tunnelResourceHasTarget(resource) &&
    !inheritedTarget
  );
}

function tunnelResourceHasTarget(
  resource: AuthTokenTunnelResourceTarget,
): boolean {
  return resource.projects !== undefined || resource.workspaces !== undefined;
}

function tunnelResourceTreeHasTarget(
  resource: RstreamAuthTokenTunnelResource,
): boolean {
  if ("AND" in resource) {
    return resource.AND.some((child) => tunnelResourceTreeHasTarget(child));
  }
  if ("OR" in resource) {
    return resource.OR.some((child) => tunnelResourceTreeHasTarget(child));
  }
  return tunnelResourceHasTarget(resource);
}

function normalizeTunnelResourceTarget(
  options?: CreateAuthTokenFromClientCredentialsOptions,
): AuthTokenTunnelResourceTarget {
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
    "Project ID or workspace ID is required when using scope-only tunnel resources.",
  );
}

function normalizeOptionalString(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export { RstreamAuthResource as RstreamAuthRessource };
