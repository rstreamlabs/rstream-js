// See LICENSE file in the project root for license information.

import { eventSchema } from "./event";
import { rstreamAuthPayloadSchema } from "./auth";
import jwt from "jsonwebtoken";
import type { Event } from "./event";
import type { RstreamAuth } from "./auth";

/**
 * Configuration for the Watch connection.
 */
export interface WatchConfig {
  /**
   * Short-term authentication token provider.
   */
  auth: RstreamAuth;

  /**
   * Engine URL to connect to. (e.g. "engine.rstream.io:443").
   */
  engine?: string;

  /**
   * Which protocol to use.
   * Defaults to "sse" (Server-Sent Events).
   */
  transport?: "sse" | "websocket";
}

/**
 * Callbacks for the different Watch events.
 */
export interface WatchEvents {
  /**
   * Called when a new message event is received.
   */
  onEvent?: (event: Event) => void;

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
  private readonly events: WatchEvents;
  constructor(config: WatchConfig, events: WatchEvents) {
    this.config = config;
    this.events = events;
  }
  public async connect(): Promise<void> {
    if (this.connectionState !== "preparing") {
      throw new Error("Watch: Connection already started or closed.");
    }
    this.connectionState = "connecting";
    const token = await this.config.auth.token();
    const payload = rstreamAuthPayloadSchema.parse(
      jwt.decode(token, { complete: false }),
    );
    const base = `https://${this.config.engine || payload.metadata?.engine || "engine.rstream.io:443"}`;
    if (this.config.transport === "sse") {
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
      const parsed = eventSchema.parse(JSON.parse(msg.data));
      this.events.onEvent?.(parsed);
    };
    this.connection.onerror = () => {
      if (this.connectionState !== "closed") {
        this.disconnect();
      }
    };
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
