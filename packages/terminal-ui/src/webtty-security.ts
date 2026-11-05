// See LICENSE file in the project root for license information.

import type { WebTTYClientEndpointIdentity } from "@rstreamlabs/webtty";
import type { WebTTYExpectedServerIdentity } from "@rstreamlabs/webtty";
import type { WebTTYPayloadCrypto } from "@rstreamlabs/webtty";
import type { WebTTYPayloadCryptoInfo } from "@rstreamlabs/webtty";

export type WebTTYTerminalSecurityConfig = {
  endpointIdentity?: WebTTYClientEndpointIdentity;
  expectedServerIdentity?: WebTTYExpectedServerIdentity;
  expectsAuthenticatedE2E?: boolean;
  payloadCrypto?: WebTTYPayloadCrypto;
};

export type WebTTYRuntimeCryptoInfo = WebTTYPayloadCryptoInfo & {
  payloadKeyId?: Uint8Array;
};

export type WebTTYCryptoBadgeState =
  "closed" | "failed" | "pending" | "verified";

export type WebTTYConnectionStatus =
  "completed" | "connected" | "connecting" | "error";

export function webTTYSecurityExpectsE2E(
  security: WebTTYTerminalSecurityConfig | undefined,
) {
  return (
    !!security?.expectsAuthenticatedE2E ||
    !!security?.endpointIdentity ||
    !!security?.expectedServerIdentity ||
    !!security?.payloadCrypto
  );
}

export function describeWebTTYPayloadCrypto(
  payloadCrypto: WebTTYPayloadCrypto | undefined,
): WebTTYRuntimeCryptoInfo | null {
  if (!payloadCrypto) return null;
  const published = payloadCrypto.cryptoInfo;
  if (published?.mode === "end-to-end") {
    const cryptoInfo = published as WebTTYRuntimeCryptoInfo;
    return {
      ...cryptoInfo,
      payloadKeyId:
        cryptoInfo.payloadKeyId ?? payloadCrypto.sessionKeyGrant?.payloadKeyId,
    };
  }
  const { keyEnvelopeSuite, payloadSuite } =
    payloadCrypto.sessionKeyGrant ?? {};
  if (
    payloadSuite !== "aes-256-gcm" ||
    keyEnvelopeSuite !== "hpke-x25519-hkdf-sha256-aes-256-gcm"
  ) {
    return null;
  }
  return {
    keyAgreement: "HPKE X25519",
    keyDerivation: "HKDF-SHA256",
    keyEncryption: "AES-256-GCM",
    keyEnvelopeSuite,
    mode: "end-to-end",
    payloadCipher: "AES-256-GCM",
    payloadKeyId: payloadCrypto.sessionKeyGrant?.payloadKeyId,
    payloadNonceBits: 96,
    payloadSuite,
    payloadTagBits: 128,
  };
}

export function formatWebTTYCryptoSessionId(
  payloadKeyId: Uint8Array | undefined,
) {
  if (!payloadKeyId?.byteLength) return null;
  const value = Array.from(payloadKeyId, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (value.length <= 20) return value;
  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}

export function webTTYCryptoBadgeState(
  status: WebTTYConnectionStatus,
  security: WebTTYTerminalSecurityConfig | undefined,
): WebTTYCryptoBadgeState | null {
  const cryptoInfo =
    status === "connected" || status === "completed"
      ? describeWebTTYPayloadCrypto(security?.payloadCrypto)
      : null;
  if (cryptoInfo) {
    return status === "completed" ? "closed" : "verified";
  }
  if (!webTTYSecurityExpectsE2E(security)) {
    return null;
  }
  return status === "error" ? "failed" : "pending";
}
