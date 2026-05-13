// See LICENSE file in the project root for license information.

import { resolveTunnelsEngine } from "./resolution";
import { authTokenSchema } from "./auth";
import { wsEventsSchema } from "./event";
import jwt from "jsonwebtoken";
import type { RstreamAuth, RstreamAuthJwtPayload } from "./auth";
import type { RstreamCredentials } from "@rstreamlabs/rstream";
import type { WsEvent } from "./event";

/**
 * Configuration for the Watch connection.
 */
export interface WatchConfig {
  /**
   * Short-term authentication token provider.
   */
  auth: RstreamAuth;

  /**
   * Engine URL to connect to. (e.g. "project-endpoint.cluster.example.rstream.test:443").
   */
  engine?: string;

  /**
   * Control-plane API URL used to resolve a managed project endpoint.
   * Defaults to https://rstream.io.
   */
  apiUrl?: string;

  /**
   * Managed tunnels project endpoint.
   * Used when the engine is not set explicitly.
   */
  projectEndpoint?: string;

  /**
   * Control-plane credentials used when resolving a managed project endpoint.
   * Defaults to the watch token itself.
   */
  controlPlaneCredentials?: RstreamCredentials;

  /**
   * Which protocol to use.
   * Defaults to "sse" (Server-Sent Events).
   */
  transport?: "sse" | "websocket";
}

/**
 * Callbacks for the different Watch events.
 */
export interface WatchWsEvents {
  /**
   * Called when a new message event is received.
   */
  onEvent?: (event: WsEvent) => void;

  /**
   * Called when the connection is successfully opened.
   */
  onConnect?: () => void;

  /**
   * Called when the connection is closed.
   */
  onClose?: () => void;
}

type ConnectionState = "preparing" | "connecting" | "connected" | "closed";

const maxWatchTokenLifetimeSeconds = 3600;
const watchTokenIssuedAtSkewSeconds = 300;

function normalizeTransport(transport?: WatchConfig["transport"]) {
  if (transport === undefined) {
    return "sse";
  }
  if (transport === "sse" || transport === "websocket") {
    return transport;
  }
  throw new Error("Watch: Unsupported transport.");
}

function validateWatchQueryToken(token: string): void {
  const parsed = authTokenSchema.safeParse(jwt.decode(token));
  if (!parsed.success || parsed.data.type === "pat") {
    throw new Error(
      "Watch requires a short-lived auth or app token for URL-based authentication.",
    );
  }
  const iat = parsed.data.iat;
  const exp = parsed.data.exp;
  const now = Math.floor(Date.now() / 1000);
  if (
    typeof iat !== "number" ||
    typeof exp !== "number" ||
    !Number.isInteger(iat) ||
    !Number.isInteger(exp) ||
    exp <= iat ||
    exp <= now ||
    exp > now + maxWatchTokenLifetimeSeconds ||
    iat > now + watchTokenIssuedAtSkewSeconds ||
    exp - iat > maxWatchTokenLifetimeSeconds
  ) {
    throw new Error(
      "Watch requires a token with a bounded lifetime of at most 3600 seconds.",
    );
  }
  if (!hasWatchOnlyTunnelGrants(parsed.data)) {
    throw new Error(
      "Watch requires a fine-grained token limited to tunnel list grants for URL-based authentication.",
    );
  }
}

function hasWatchOnlyTunnelGrants(token: RstreamAuthJwtPayload): boolean {
  if (!hasWatchOnlyPermissions(token.permissions)) {
    return false;
  }
  if (token.tunnelsGrants === undefined) {
    return false;
  }
  return hasWatchOnlyTunnelGrant(token.tunnelsGrants);
}

function hasWatchOnlyTunnelGrant(
  grant: NonNullable<RstreamAuthJwtPayload["tunnelsGrants"]>,
): boolean {
  return watchGrantBranches(grant).every(
    (branch) => branch.hasList && !branch.hasMutationOrConnect,
  );
}

type WatchGrantBranch = {
  hasList: boolean;
  hasMutationOrConnect: boolean;
};

function watchGrantBranches(
  grant: NonNullable<RstreamAuthJwtPayload["tunnelsGrants"]>,
): WatchGrantBranch[] {
  if ("AND" in grant) {
    return grant.AND.reduce<WatchGrantBranch[]>(
      (branches, child) => combineWatchGrantBranches(branches, child),
      [{ hasList: false, hasMutationOrConnect: false }],
    );
  }
  if ("OR" in grant) {
    return grant.OR.flatMap(watchGrantBranches);
  }
  const tunnels = grant.scopes?.tunnels;
  if (tunnels === undefined) {
    return [{ hasList: false, hasMutationOrConnect: false }];
  }
  return [
    {
      hasList: tunnels.list !== undefined,
      hasMutationOrConnect:
        tunnels.create !== undefined || tunnels.connect !== undefined,
    },
  ];
}

function combineWatchGrantBranches(
  branches: WatchGrantBranch[],
  child: NonNullable<RstreamAuthJwtPayload["tunnelsGrants"]>,
): WatchGrantBranch[] {
  return branches.flatMap((branch) =>
    watchGrantBranches(child).map((childBranch) => ({
      hasList: branch.hasList || childBranch.hasList,
      hasMutationOrConnect:
        branch.hasMutationOrConnect || childBranch.hasMutationOrConnect,
    })),
  );
}

function hasWatchOnlyPermissions(
  permissions: RstreamAuthJwtPayload["permissions"],
): boolean {
  if (!Array.isArray(permissions)) {
    return true;
  }
  return permissions.every(
    (permission) =>
      permission === "tunnels.resources.read-only" ||
      permission === "network.resources.read-only",
  );
}

export class Watch {
  private connection: EventSource | WebSocket | null = null;
  private connectionState: ConnectionState = "preparing";
  private readonly config: WatchConfig;
  private readonly events: WatchWsEvents;

  constructor(config: WatchConfig, events: WatchWsEvents) {
    this.config = config;
    this.events = events;
  }

  public async connect(): Promise<void> {
    if (this.connectionState !== "preparing") {
      throw new Error("Watch: Connection already started or closed.");
    }
    this.connectionState = "connecting";
    try {
      const token =
        typeof this.config.auth === "function"
          ? await this.config.auth()
          : this.config.auth;
      validateWatchQueryToken(token);
      const engine = await resolveTunnelsEngine({
        apiUrl: this.config.apiUrl,
        controlPlaneCredentials: this.config.controlPlaneCredentials,
        engine: this.config.engine,
        projectEndpoint: this.config.projectEndpoint,
        token,
      });
      const transport = normalizeTransport(this.config.transport);
      const base = `https://${engine}`;
      if (transport === "sse") {
        const url = new URL(`/api/sse`, base);
        url.searchParams.set("rstream.token", token);
        this.connection = new EventSource(url.toString());
      } else {
        const url = new URL(`/api/websocket`, base);
        url.searchParams.set("rstream.token", token);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        this.connection = new WebSocket(url.toString());
      }
      this.connection.onopen = () => {
        this.connectionState = "connected";
        this.events.onConnect?.();
      };
      this.connection.onmessage = (msg) => this.handleMessage(msg.data);
      this.connection.onerror = () => {
        if (this.connectionState !== "closed") {
          this.disconnect();
        }
      };
      if (this.connection instanceof WebSocket) {
        this.connection.onclose = () => {
          if (this.connectionState !== "closed") {
            this.disconnect();
          }
        };
      }
    } catch (error) {
      this.connectionState = "preparing";
      throw error;
    }
  }

  private handleMessage(data: string): void {
    try {
      const parsed = wsEventsSchema.parse(JSON.parse(data));
      this.events.onEvent?.(parsed);
    } catch {
      this.disconnect();
    }
  }

  public disconnect(): void {
    if (this.connection) {
      this.connection.onerror = null;
      this.connection.onmessage = null;
      this.connection.onopen = null;
      this.connection.close();
      this.connection = null;
    }
    if (this.connectionState !== "closed") {
      this.connectionState = "closed";
      this.events.onClose?.();
    }
  }
}
