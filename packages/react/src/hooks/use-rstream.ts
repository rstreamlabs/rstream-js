// See LICENSE file in the project root for license information.

import { Watch } from "@rstreamlabs/tunnels";
import * as React from "react";
import type { Tunnel } from "@rstreamlabs/rstream/tunnel";
import type { Client } from "@rstreamlabs/tunnels";
import type { WatchConfig } from "@rstreamlabs/tunnels";

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

interface UseRstreamRuntime {
  active: boolean;
  timeout: ReturnType<typeof setTimeout> | null;
  watch: Watch | null;
}

function credentialsKey(
  credentials?: WatchConfig["controlPlaneCredentials"],
): string {
  if (!credentials) {
    return "";
  }
  if ("token" in credentials) {
    return `token:${credentials.token}`;
  }
  return `client:${credentials.clientId}:${credentials.clientSecret}`;
}

function watchConnectionKey(options?: UseRstreamOptions): string {
  if (!hasAuth(options)) {
    return "disabled";
  }
  return JSON.stringify({
    apiUrl: options.apiUrl ?? null,
    auth:
      typeof options.auth === "function" ? "function" : `token:${options.auth}`,
    controlPlaneCredentials: credentialsKey(options.controlPlaneCredentials),
    engine: options.engine ?? null,
    projectEndpoint: options.projectEndpoint ?? null,
    transport: options.transport ?? "sse",
  });
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
  const authEnabled = hasAuth(options);
  const connectionKey = watchConnectionKey(options);
  const optionsRef = React.useRef<UseRstreamOptions | undefined>(options);
  React.useEffect(() => {
    optionsRef.current = options;
  }, [options]);
  const getWatchOptions = React.useEffectEvent(() => {
    const current = optionsRef.current;
    return hasAuth(current) ? current : undefined;
  });
  React.useEffect(() => {
    if (!authEnabled) return;
    const runtime: UseRstreamRuntime = {
      active: true,
      timeout: null,
      watch: null,
    };
    const schedule = () => {
      if (!runtime.active) return;
      if (runtime.timeout) return;
      setState("connecting");
      runtime.timeout = setTimeout(() => {
        if (!runtime.active) return;
        runtime.timeout = null;
        run();
      }, reconnectTimeout);
    };
    const run = async () => {
      const watchOptions = getWatchOptions();
      if (!watchOptions) return;
      setState("connecting");
      runtime.watch = new Watch(watchOptions, {
        onEvent: (event) => {
          if (!runtime.active) return;
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
          if (!runtime.active) return;
          setState("connected");
        },
        onClose: () => {
          if (!runtime.active) return;
          runtime.watch = null;
          schedule();
        },
      });
      try {
        await runtime.watch.connect();
      } catch {
        schedule();
      }
    };
    run();
    return () => {
      runtime.active = false;
      if (runtime.watch) {
        runtime.watch.disconnect();
        runtime.watch = null;
      }
      if (runtime.timeout) {
        clearTimeout(runtime.timeout);
        runtime.timeout = null;
      }
    };
  }, [authEnabled, connectionKey, reconnectTimeout]);
  React.useEffect(() => {
    if (authEnabled) {
      if (error && error.type === "danger") return;
      if (state !== "connected") {
        const timeout = setTimeout(() => {
          setError({
            message: "Failed to fetch rstream resources. Retrying...",
            type: "warning",
          });
        }, errorTimeout);
        return () => {
          clearTimeout(timeout);
        };
      } else if (state === "connected") {
        const timeout = setTimeout(() => setError(null), 0);
        return () => clearTimeout(timeout);
      }
    } else {
      const timeout = setTimeout(() => setError(null), 0);
      return () => clearTimeout(timeout);
    }
  }, [authEnabled, state, error, errorTimeout]);
  React.useEffect(() => {
    if (!authEnabled || state !== "connected") {
      const timeout = setTimeout(() => {
        setClients([]);
        setTunnels([]);
      }, 0);
      return () => clearTimeout(timeout);
    }
  }, [authEnabled, connectionKey, state]);
  return { state, error, tunnels, clients };
}
