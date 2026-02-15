// See LICENSE file in the project root for license information.

import { Client } from "@rstreamlabs/rstream";
import { Tunnel } from "@rstreamlabs/rstream";
import { Watch } from "@rstreamlabs/rstream";
import * as React from "react";
import type { WatchConfig } from "@rstreamlabs/rstream";

/**
 * Configuration for the UseRstream hook.
 */
export interface UseRstreamOptions extends Partial<WatchConfig> {
  /**
   * Timeout (in milliseconds) to wait before attempting to reconnect
   * after the SSE connection is closed.
   *
   * @default 1000
   */
  reconnectTimeout?: number;

  /**
   * Timeout (in milliseconds) to wait before showing an error message
   * when the connection is not yet established.
   *
   * @default 5000
   */
  errorTimeout?: number;
}

function hasAuth(options?: UseRstreamOptions): options is WatchConfig {
  return !!options && !!options.auth;
}

/**
 * A React hook to subscribe to rstream resources.
 *
 * This hook fetches the list of clients and tunnels from the rstream API.
 * It handles automatic reconnection and displays a warning if the connection
 * is not established within the timeout.
 *
 * @param options - The configuration options for the hook.
 * @returns An object with the current error (if any), and arrays of tunnels and clients.
 */
export function useRstream(options?: UseRstreamOptions) {
  const [state, setState] = React.useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const [error, setError] = React.useState<{
    message: string;
    type: "warning" | "danger";
  } | null>(null);
  const { reconnectTimeout = 1000, errorTimeout = 5000 } = options || {};
  const [clients, setClients] = React.useState<Client[]>([]);
  const [tunnels, setTunnels] = React.useState<Tunnel[]>([]);
  React.useEffect(() => {
    if (!hasAuth(options)) return;
    let active = true;
    let watch: Watch | null = null;
    let timeout: NodeJS.Timeout | null = null;
    const schedule = () => {
      if (!active) return;
      if (timeout) return;
      setState("connecting");
      timeout = setTimeout(() => {
        if (!active) return;
        timeout = null;
        run();
      }, reconnectTimeout);
    };
    const run = async () => {
      if (!hasAuth(options)) return;
      setState("connecting");
      watch = new Watch(options, {
        onEvent: (event) => {
          if (!active) return;
          if (event.type === "state.initial") {
            setClients(event.object.clients);
            setTunnels(event.object.tunnels);
          } else if (event.type.startsWith("client")) {
            setClients((previous) => {
              if (event.type === "client.created") {
                return [...previous, event.object];
              } else if (event.type === "client.updated") {
                return previous.map((client) => {
                  if (client.id === event.object.id) {
                    return event.object;
                  }
                  return client;
                });
              } else if (event.type === "client.deleted") {
                return previous.filter(
                  (client) => client.id !== event.object.id,
                );
              }
              return previous;
            });
          } else if (event.type.startsWith("tunnel")) {
            setTunnels((previous) => {
              if (event.type === "tunnel.created") {
                return [...previous, event.object];
              } else if (event.type === "tunnel.updated") {
                return previous.map((tunnel) => {
                  if (tunnel.id === event.object.id) {
                    return event.object;
                  }
                  return tunnel;
                });
              } else if (event.type === "tunnel.deleted") {
                return previous.filter(
                  (tunnel) => tunnel.id !== event.object.id,
                );
              }
              return previous;
            });
          }
        },
        onConnect: () => {
          if (!active) return;
          setState("connected");
        },
        onClose: () => {
          if (!active) return;
          watch = null;
          schedule();
        },
      });
      try {
        await watch.connect();
      } catch {
        schedule();
      }
    };
    run();
    return () => {
      active = false;
      if (watch) {
        watch.disconnect();
        watch = null;
      }
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    };
  }, [options, reconnectTimeout]);
  React.useEffect(() => {
    if (options?.auth) {
      if (error && error.type === "danger") return;
      if (state !== "connected") {
        const timeout = setTimeout(() => {
          setError({
            message: "Failed to fetch rstream ressources. Retrying...",
            type: "warning",
          });
        }, errorTimeout);
        return () => {
          clearTimeout(timeout);
        };
      } else if (state === "connected") {
        setError(null);
      }
    } else {
      setError(null);
    }
  }, [options, state, error, errorTimeout]);
  React.useEffect(() => {
    if (options?.auth === undefined || state !== "connected") {
      setClients([]);
      setTunnels([]);
    }
  }, [options, state]);
  return { state, error, tunnels, clients };
}
