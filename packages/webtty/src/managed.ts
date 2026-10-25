// See LICENSE file in the project root for license information.

import type { WebTTYClientConfig } from "./webtty";
import type { WebTTYClientTransport } from "./webtty";

export interface WebTTYManagedCapabilities {
  managed_protocol: boolean;
  detached_execution?: boolean;
  explicit_termination?: boolean;
  execution_transports?: readonly (WebTTYClientTransport | "plain")[];
  max_execution_seconds?: number;
}

export interface WebTTYManagedSessionConfig {
  /** Fetch from the same Engine's WebTTY capabilities API before connecting. */
  capabilities: WebTTYManagedCapabilities;
  /** Positive seconds opt a new non-interactive command into detached execution. */
  executionSeconds?: number;
}

export function copyManagedSessionConfig(
  managed: WebTTYManagedSessionConfig | undefined,
): WebTTYManagedSessionConfig | undefined {
  return managed === undefined
    ? undefined
    : {
        executionSeconds: managed.executionSeconds,
        capabilities: {
          ...managed.capabilities,
          execution_transports:
            managed.capabilities.execution_transports?.slice(),
        },
      };
}

export function managedSessionURL(
  client: WebTTYClientConfig,
  transport: WebTTYClientTransport,
  interactive: boolean,
  allocateTty: boolean,
): string {
  const managed = client.managed;
  if (managed === undefined) return client.url.toString();
  const seconds = managed.executionSeconds ?? 0;
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    throw new Error("WebTTY execution duration must be a positive integer.");
  }
  if (seconds === 0) return client.url.toString();
  if (!managed.capabilities.managed_protocol) {
    throw new Error("Engine does not support managed WebTTY.");
  }
  if (client.attach !== undefined || interactive || allocateTty) {
    throw new Error(
      "Detached WebTTY execution requires a new non-interactive command without a TTY.",
    );
  }
  if (!managed.capabilities.detached_execution) {
    throw new Error("Engine does not support detached WebTTY execution.");
  }
  const limit = managed.capabilities.max_execution_seconds ?? 0;
  if (!Number.isSafeInteger(limit) || seconds > limit) {
    throw new Error("WebTTY execution duration exceeds the Engine limit.");
  }
  if (!managed.capabilities.execution_transports?.includes(transport)) {
    throw new Error(
      `Engine does not support detached WebTTY execution over ${transport}.`,
    );
  }
  const url = new URL(client.url);
  if (url.searchParams.has("execution_seconds")) {
    throw new Error(
      "WebTTY execution duration must be supplied only through managed.executionSeconds.",
    );
  }
  const modes = url.searchParams.getAll("session_mode");
  if (
    modes.length > 1 ||
    (modes.length === 1 && modes[0] !== "non-interactive")
  ) {
    throw new Error(
      "Detached WebTTY execution conflicts with the URL session mode.",
    );
  }
  url.searchParams.set("execution_seconds", String(seconds));
  url.searchParams.set("session_mode", "non-interactive");
  return url.toString();
}

export function managedTerminationSupported(
  client: WebTTYClientConfig,
): boolean {
  return client.managed === undefined && client.attach === undefined
    ? true
    : client.managed?.capabilities.explicit_termination === true;
}

export function managedSessionIdentity(
  client: WebTTYClientConfig,
  identity: string | null | undefined,
): string | undefined {
  if (client.attach !== undefined) {
    if (identity && identity !== client.attach.sessionId) {
      throw new Error("WebTTY Ack does not identify the attached session.");
    }
    return client.attach.sessionId;
  }
  if ((client.managed?.executionSeconds ?? 0) === 0) return undefined;
  if (!identity || identity.length > 256 || identity !== identity.trim()) {
    throw new Error(
      "Engine did not confirm the detached WebTTY session identity.",
    );
  }
  return identity;
}
