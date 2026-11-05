// See LICENSE file in the project root for license information.

import { redactEndpointCredentials } from "@rstreamlabs/webtty";

export type WebTTYTerminalSecurityState = {
  hasClientEndpointIdentity?: boolean;
  hasExpectedServerIdentity?: boolean;
  expectsAuthenticatedE2E?: boolean;
};

export function normalizeWebTTYTerminalError(
  message: string,
  security: WebTTYTerminalSecurityState | undefined,
) {
  const value = message.trim();
  const lowerValue = value.toLowerCase();
  if (lowerValue.includes("client signing key is not authorized")) {
    if (security?.hasClientEndpointIdentity) {
      return "This WebTTY server rejected the configured client endpoint identity. Authorize this client identity on the server, then reconnect.";
    }
    return "This WebTTY server requires authenticated end-to-end encryption, but this browser has no client endpoint identity authorized for it.";
  }
  if (lowerValue.includes("server proof verification failed")) {
    return "This WebTTY server identity could not be verified. Review the known server endpoint identity before reconnecting.";
  }
  if (
    value.includes("Unexpected server hello message") ||
    value.includes("requires authenticated E2E") ||
    value.includes("requires a client proof") ||
    value.includes("client proof is required")
  ) {
    if (
      security?.hasExpectedServerIdentity &&
      !security.hasClientEndpointIdentity
    ) {
      return "This WebTTY server requires authenticated end-to-end encryption, but this browser has no client endpoint identity authorized for it.";
    }
    return "This WebTTY server requires authenticated end-to-end encryption. Configure a known server endpoint identity and an authorized client endpoint identity before opening the session.";
  }
  return value;
}

/** Browser transport errors can echo the URL, including its bearer credential. */
export function redactWebTTYConnectionCredentials(
  message: string,
  url?: string,
): string {
  const redacted = url ? redactEndpointCredentials(message, url) : message;
  // Preparation failures may include an endpoint before a connection exists.
  return redacted.replace(/(?:https?|wss?):\/\/[^\s<>"']+/gi, (endpoint) =>
    redactEndpointCredentials(endpoint, endpoint),
  );
}
