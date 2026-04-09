// See LICENSE file in the project root for license information.

import { resolveTunnelsEngine } from "./resolution";
import { wsEventsSchema } from "./event";
import type { RstreamAuth } from "./auth";
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
    const token =
      typeof this.config.auth === "function"
        ? await this.config.auth()
        : this.config.auth;
    const engine = await resolveTunnelsEngine({
      apiUrl: this.config.apiUrl,
      controlPlaneCredentials: this.config.controlPlaneCredentials,
      engine: this.config.engine,
      projectEndpoint: this.config.projectEndpoint,
      token,
    });
    const transport = this.config.transport ?? "sse";
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
    this.connection.onmessage = (msg) => {
      const parsed = wsEventsSchema.parse(JSON.parse(msg.data));
      this.events.onEvent?.(parsed);
    };
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
