// See LICENSE file in the project root for license information.

import { hashWebTTYAttachGrant } from "./auth-proof";
import { hashWebTTYClientCredential } from "./auth-proof";
import { hashWebTTYConfig } from "./auth-proof";
import { hashWebTTYServerProofTranscript } from "./auth-proof";
import { hashWebTTYSessionKeyGrant } from "./auth-proof";
import { signWebTTYClientProofTranscript } from "./auth-proof";
import { verifyWebTTYServerProofTranscript } from "./auth-proof";
import * as WebTTYProto from "../.generated/protobuf/webtty";
import type { WebTTYSigningIdentity } from "./auth-proof";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getWebSocketPayload(
  payload: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> {
  return new Uint8Array(payload);
}

function getFramePayload(
  payload: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> {
  const frame = new Uint8Array(4 + payload.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, payload.byteLength, false);
  frame.set(payload, 4);
  return frame;
}

type MaybePromise<T> = T | Promise<T>;

function isPromiseLike<T>(value: MaybePromise<T>): value is Promise<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function messagePayloadBytes(payload: unknown): Uint8Array {
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(
      payload.buffer.slice(
        payload.byteOffset,
        payload.byteOffset + payload.byteLength,
      ),
    );
  }
  const tag = Object.prototype.toString.call(payload);
  throw new TypeError(
    `Unsupported WebTTY message payload type ${tag}; expected binary ArrayBuffer or Uint8Array.`,
  );
}

/**
 * Client-level configuration for WebTTY.
 */
export interface WebTTYClientConfig {
  /**
   * The remote WebTTY endpoint.
   */
  url: string | URL;

  /**
   * Transport used to carry WebTTY protobuf messages.
   *
   * @default "websocket"
   */
  transport?: WebTTYClientTransport;

  /**
   * Browser WebTransport constructor options.
   *
   * Useful for local development and tests that rely on pinned certificate
   * hashes. Production endpoints should normally use publicly trusted TLS
   * certificates and leave this unset.
   */
  webTransportOptions?: WebTTYWebTransportOptions;

  /**
   * Attach to an existing engine-managed WebTTY session instead of opening a
   * new remote process. The attach grant is issued by the control-plane API;
   * terminal bytes still flow through the WebTTY protobuf stream.
   */
  attach?: WebTTYAttachConfig;

  /**
   * Whether to send heartbeats to keep the session alive.
   *
   * @default true
   */
  sendHeartbeat?: boolean;

  /**
   * Heartbeat interval in milliseconds.
   *
   * @default 5000
   */
  heartbeatIntervalMs?: number;

  /**
   * Local endpoint identity used to sign a client proof when the server
   * requires authenticated WebTTY endpoints.
   */
  endpointIdentity?: WebTTYClientEndpointIdentity;

  /**
   * Signed workspace credential bound into the client proof.
   */
  clientCredential?: Uint8Array;

  /**
   * Expected server identity. When set, the client waits for ServerHello,
   * verifies the server proof, and only then sends Open.
   */
  expectedServerIdentity?: WebTTYExpectedServerIdentity;

  /**
   * Principal metadata bound into client proofs.
   */
  clientPrincipalId?: string;
  clientDeviceId?: string;
  clientBrowserId?: string;
}

export type WebTTYClientTransport = "websocket" | "webtransport";

export interface WebTTYClientEndpointIdentity {
  signing: WebTTYSigningIdentity;
}

export interface WebTTYExpectedServerIdentity {
  encryptionKeyId: Uint8Array;
  encryptionPublicKey: Uint8Array;
  signingKeyId: Uint8Array;
  signingPublicKey: Uint8Array;
}

export type WebTTYAttachRole = "spectator" | "controller";

export type WebTTYAttachCapability =
  | "read_stream"
  | "request_control"
  | "receive_control";

export interface WebTTYAttachConfig {
  attachGrant: Uint8Array;
  browserId?: string;
  capabilities?: WebTTYAttachCapability[];
  deviceId?: string;
  participantId: string;
  projectId?: string;
  requestedRole?: WebTTYAttachRole;
  serverId?: string;
  sessionId: string;
  transport?: WebTTYClientTransport;
  workspaceId?: string;
}

export interface WebTTYWebTransportCertificateHash {
  algorithm: string;
  value: BufferSource;
}

export interface WebTTYWebTransportOptions {
  serverCertificateHashes?: WebTTYWebTransportCertificateHash[];
}

export type WebTTYOpenCapability = "encrypted-payload" | "session-crypto";

export type WebTTYPayloadCipherSuite = "aes-256-gcm" | "chacha20-poly1305";

export type WebTTYKeyEnvelopeSuite =
  | "hpke-x25519-hkdf-sha256-aes-256-gcm"
  | "hpke-x25519-hkdf-sha256-chacha20-poly1305";

export type WebTTYE2EPayloadCipherSuite = "aes-256-gcm";

export type WebTTYE2EKeyEnvelopeSuite = "hpke-x25519-hkdf-sha256-aes-256-gcm";

export interface WebTTYKeyEnvelope {
  encapsulatedKey?: Uint8Array;
  recipientKeyId?: Uint8Array;
  wrappedKey?: Uint8Array;
}

export interface WebTTYSessionKeyGrant {
  keyContext?: Uint8Array;
  keyEnvelopes?: WebTTYKeyEnvelope[];
  keyEnvelopeSuite?: WebTTYKeyEnvelopeSuite;
  payloadKeyId?: Uint8Array;
  payloadSuite?: WebTTYPayloadCipherSuite;
}

export interface WebTTYPayloadCryptoMetadata {
  aadContext?: Uint8Array;
  nonce?: Uint8Array;
  payloadKeyId?: Uint8Array;
  payloadSuite?: WebTTYPayloadCipherSuite;
}

/**
 * Human-readable crypto suite information for UI surfaces and tooling.
 */
export interface WebTTYPayloadCryptoInfo {
  /**
   * End-to-end terminal stream encryption is active.
   */
  mode: "end-to-end";

  /**
   * Cipher used for stdin, stdout, and stderr payloads.
   */
  payloadCipher: "AES-256-GCM";

  /**
   * Authenticated encryption tag length in bits.
   */
  payloadTagBits: 128;

  /**
   * Per-message nonce length in bits.
   */
  payloadNonceBits: 96;

  /**
   * Non-secret session payload key identifier.
   */
  payloadKeyId?: Uint8Array;

  /**
   * Key encapsulation mechanism used to grant access to the payload key.
   */
  keyAgreement: "HPKE X25519";

  /**
   * Key derivation function used by HPKE.
   */
  keyDerivation: "HKDF-SHA256";

  /**
   * AEAD used by HPKE to wrap the payload key.
   */
  keyEncryption: "AES-256-GCM";

  keyEnvelopeSuite: WebTTYKeyEnvelopeSuite;
  payloadSuite: WebTTYPayloadCipherSuite;
}

/**
 * Encrypted payload exchanged through WebTTY Data messages.
 */
export interface WebTTYEncryptedPayload {
  ciphertext: Uint8Array;
  payloadCrypto?: WebTTYPayloadCryptoMetadata;
  plaintextLength: number;
}

/**
 * Optional payload crypto hooks for managed WebTTY sessions.
 */
export interface WebTTYPayloadCrypto {
  capabilities?: WebTTYOpenCapability[];
  cryptoInfo?: WebTTYPayloadCryptoInfo;
  decryptStderr?: (payload: WebTTYEncryptedPayload) => MaybePromise<Uint8Array>;
  decryptStdout?: (payload: WebTTYEncryptedPayload) => MaybePromise<Uint8Array>;
  encryptStdin?: (chunk: Uint8Array) => MaybePromise<WebTTYEncryptedPayload>;
  sessionKeyGrant?: WebTTYSessionKeyGrant;
}

/**
 * Execution-level configuration for WebTTY.
 */
export interface WebTTYExecutionConfig {
  /**
   * Command arguments to run on the remote side.
   */
  cmdArgs?: string[];

  /**
   * Environment variables to set for the remote session.
   */
  envVars?: Array<{ key: string; value: string }>;

  /**
   * Whether the server should allocate a TTY.
   *
   * @default true
   */
  allocateTty?: boolean;

  /**
   * Whether the session is interactive.
   *
   * @default true
   */
  interactive?: boolean;

  /**
   * Optional username (by name or ID).
   */
  username?: string | number;

  /**
   * Optional working directory for the remote process.
   */
  workdir?: string;

  /**
   * Optional end-to-end payload crypto hooks. When configured, protocol
   * metadata remains visible to the WebTTY server while stdin/stdout/stderr
   * bytes can be carried as encrypted payloads.
   */
  payloadCrypto?: WebTTYPayloadCrypto;
}

/**
 * WebTTY events for handling session state and data streams.
 */
export interface WebTTYEvents {
  /**
   * Called whenever the server sends data on STDOUT.
   */
  onStdout?: (chunk: Uint8Array) => void;

  /**
   * Called whenever STDOUT reaches end-of-stream.
   */
  onStdoutEos?: () => void;

  /**
   * Called whenever the server sends data on STDERR.
   */
  onStderr?: (chunk: Uint8Array) => void;

  /**
   * Called whenever STDERR reaches end-of-stream.
   */
  onStderrEos?: () => void;

  /**
   * Called when the connection is established.
   */
  onConnect?: () => void;

  /**
   * Called when the remote process exits, providing the exit code.
   */
  onComplete?: (exitCode: number) => void;

  /**
   * Called when the server or connection encounters an error.
   */
  onError?: (errMsg: string) => void;
}

/**
 * Possible internal states of the WebTTY's connection lifecycle.
 */
type ConnectionState = "preparing" | "connecting" | "connected" | "closed";
type ResolvedWebTTYClientConfig = Omit<
  WebTTYClientConfig,
  "attach" | "transport"
> & {
  attach?: ResolvedWebTTYAttachConfig;
  heartbeatIntervalMs: number;
  sendHeartbeat: boolean;
  transport: WebTTYClientTransport;
};
type ResolvedWebTTYExecutionConfig = WebTTYExecutionConfig & {
  allocateTty: boolean;
  envVars: Array<{ key: string; value: string }>;
  interactive: boolean;
};

type ResolvedWebTTYAttachConfig = Required<
  Pick<
    WebTTYAttachConfig,
    | "attachGrant"
    | "capabilities"
    | "participantId"
    | "requestedRole"
    | "sessionId"
    | "transport"
  >
> &
  Pick<
    WebTTYAttachConfig,
    "browserId" | "deviceId" | "projectId" | "serverId" | "workspaceId"
  >;

interface WebTTYMessageConnection {
  close(): void;
  send(payload: Uint8Array<ArrayBufferLike>): void;
}

interface WebTransportLike {
  close(closeInfo?: { closeCode?: number; reason?: string }): void;
  closed: Promise<unknown>;
  createBidirectionalStream(): Promise<WebTransportBidirectionalStreamLike>;
  ready: Promise<unknown>;
}

interface WebTransportBidirectionalStreamLike {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}

type WebTransportConstructorLike = new (
  url: string,
  options?: WebTTYWebTransportOptions,
) => WebTransportLike;

function capabilityToProto(
  capability: WebTTYOpenCapability,
): WebTTYProto.rstream.webtty.protobuf.OpenCapability {
  switch (capability) {
    case "encrypted-payload":
      return WebTTYProto.rstream.webtty.protobuf.OpenCapability
        .OPEN_CAPABILITY_ENCRYPTED_PAYLOAD;
    case "session-crypto":
      return WebTTYProto.rstream.webtty.protobuf.OpenCapability
        .OPEN_CAPABILITY_SESSION_CRYPTO;
  }
}

function payloadCipherSuiteToProto(
  suite: WebTTYPayloadCipherSuite | undefined,
): WebTTYProto.rstream.webtty.protobuf.PayloadCipherSuite {
  switch (suite) {
    case "aes-256-gcm":
      return WebTTYProto.rstream.webtty.protobuf.PayloadCipherSuite
        .PAYLOAD_CIPHER_SUITE_AES_256_GCM;
    case "chacha20-poly1305":
      return WebTTYProto.rstream.webtty.protobuf.PayloadCipherSuite
        .PAYLOAD_CIPHER_SUITE_CHACHA20_POLY1305;
    default:
      return WebTTYProto.rstream.webtty.protobuf.PayloadCipherSuite
        .PAYLOAD_CIPHER_SUITE_UNSPECIFIED;
  }
}

function payloadCipherSuiteFromProto(
  suite:
    | WebTTYProto.rstream.webtty.protobuf.PayloadCipherSuite
    | null
    | undefined,
): WebTTYPayloadCipherSuite | undefined {
  switch (suite) {
    case WebTTYProto.rstream.webtty.protobuf.PayloadCipherSuite
      .PAYLOAD_CIPHER_SUITE_AES_256_GCM:
      return "aes-256-gcm";
    case WebTTYProto.rstream.webtty.protobuf.PayloadCipherSuite
      .PAYLOAD_CIPHER_SUITE_CHACHA20_POLY1305:
      return "chacha20-poly1305";
    default:
      return undefined;
  }
}

function keyEnvelopeSuiteToProto(
  suite: WebTTYKeyEnvelopeSuite | undefined,
): WebTTYProto.rstream.webtty.protobuf.KeyEnvelopeSuite {
  switch (suite) {
    case "hpke-x25519-hkdf-sha256-aes-256-gcm":
      return WebTTYProto.rstream.webtty.protobuf.KeyEnvelopeSuite
        .KEY_ENVELOPE_SUITE_HPKE_X25519_HKDF_SHA256_AES_256_GCM;
    case "hpke-x25519-hkdf-sha256-chacha20-poly1305":
      return WebTTYProto.rstream.webtty.protobuf.KeyEnvelopeSuite
        .KEY_ENVELOPE_SUITE_HPKE_X25519_HKDF_SHA256_CHACHA20_POLY1305;
    default:
      return WebTTYProto.rstream.webtty.protobuf.KeyEnvelopeSuite
        .KEY_ENVELOPE_SUITE_UNSPECIFIED;
  }
}

function keyEnvelopeSuiteFromProto(
  suite:
    | WebTTYProto.rstream.webtty.protobuf.KeyEnvelopeSuite
    | null
    | undefined,
): WebTTYKeyEnvelopeSuite | undefined {
  switch (suite) {
    case WebTTYProto.rstream.webtty.protobuf.KeyEnvelopeSuite
      .KEY_ENVELOPE_SUITE_HPKE_X25519_HKDF_SHA256_AES_256_GCM:
      return "hpke-x25519-hkdf-sha256-aes-256-gcm";
    case WebTTYProto.rstream.webtty.protobuf.KeyEnvelopeSuite
      .KEY_ENVELOPE_SUITE_HPKE_X25519_HKDF_SHA256_CHACHA20_POLY1305:
      return "hpke-x25519-hkdf-sha256-chacha20-poly1305";
    default:
      return undefined;
  }
}

function signatureSuiteFromProto(
  suite: WebTTYProto.rstream.webtty.protobuf.SignatureSuite | null | undefined,
): "ecdsa-p256-sha256" | undefined {
  switch (suite) {
    case WebTTYProto.rstream.webtty.protobuf.SignatureSuite
      .SIGNATURE_SUITE_ECDSA_P256_SHA256:
      return "ecdsa-p256-sha256";
    default:
      return undefined;
  }
}

function authRequirementFromProto(
  value: WebTTYProto.rstream.webtty.protobuf.AuthRequirement | null | undefined,
): "none" | "client-proof" | undefined {
  switch (value) {
    case WebTTYProto.rstream.webtty.protobuf.AuthRequirement
      .AUTH_REQUIREMENT_NONE:
      return "none";
    case WebTTYProto.rstream.webtty.protobuf.AuthRequirement
      .AUTH_REQUIREMENT_CLIENT_PROOF:
      return "client-proof";
    default:
      return undefined;
  }
}

function bytesEqual(
  left: Uint8Array | null | undefined,
  right: Uint8Array | null | undefined,
): boolean {
  if (
    left === undefined ||
    left === null ||
    right === undefined ||
    right === null
  ) {
    return left === right;
  }
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

function optionalString(
  value:
    | string
    | WebTTYProto.google.protobuf.StringValue.$Properties
    | null
    | undefined,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : (value.value ?? undefined);
}

function optionalBytes(
  value: Uint8Array | null | undefined,
): Uint8Array | undefined {
  return value === null ? undefined : value;
}

function stringValue(
  value: string | undefined,
): WebTTYProto.google.protobuf.StringValue.$Properties | undefined {
  const trimmed = trimOptional(value);
  return trimmed === undefined ? undefined : { value: trimmed };
}

function bytesValue(
  value: Uint8Array | undefined,
): WebTTYProto.google.protobuf.BytesValue.$Properties | undefined {
  return value === undefined || value.byteLength === 0 ? undefined : { value };
}

function keyEnvelopeToProto(
  envelope: WebTTYKeyEnvelope,
): WebTTYProto.rstream.webtty.protobuf.KeyEnvelope {
  return new WebTTYProto.rstream.webtty.protobuf.KeyEnvelope({
    encapsulatedKey: envelope.encapsulatedKey,
    recipientKeyId: envelope.recipientKeyId,
    wrappedKey: envelope.wrappedKey,
  });
}

function sessionKeyGrantToProto(
  crypto: WebTTYSessionKeyGrant | undefined,
): WebTTYProto.rstream.webtty.protobuf.SessionKeyGrant | undefined {
  if (crypto === undefined) return undefined;
  return new WebTTYProto.rstream.webtty.protobuf.SessionKeyGrant({
    keyContext: crypto.keyContext,
    keyEnvelopeSuite: keyEnvelopeSuiteToProto(crypto.keyEnvelopeSuite),
    keyEnvelopes: crypto.keyEnvelopes?.map(keyEnvelopeToProto),
    payloadKeyId: crypto.payloadKeyId,
    payloadSuite: payloadCipherSuiteToProto(crypto.payloadSuite),
  });
}

function payloadCryptoToProto(
  crypto: WebTTYPayloadCryptoMetadata | undefined,
): WebTTYProto.rstream.webtty.protobuf.PayloadCrypto | undefined {
  if (crypto === undefined) return undefined;
  return new WebTTYProto.rstream.webtty.protobuf.PayloadCrypto({
    aadContext: crypto.aadContext,
    nonce: crypto.nonce,
    payloadKeyId: crypto.payloadKeyId,
    payloadSuite: payloadCipherSuiteToProto(crypto.payloadSuite),
  });
}

function payloadCryptoFromProto(
  crypto:
    | WebTTYProto.rstream.webtty.protobuf.PayloadCrypto.$Properties
    | null
    | undefined,
): WebTTYPayloadCryptoMetadata | undefined {
  if (crypto === null || crypto === undefined) return undefined;
  return {
    aadContext: crypto.aadContext ?? undefined,
    nonce: crypto.nonce ?? undefined,
    payloadKeyId: crypto.payloadKeyId ?? undefined,
    payloadSuite: payloadCipherSuiteFromProto(crypto.payloadSuite),
  };
}

function encryptedPayloadToProto(
  payload: WebTTYEncryptedPayload,
): WebTTYProto.rstream.webtty.protobuf.EncryptedPayload {
  return new WebTTYProto.rstream.webtty.protobuf.EncryptedPayload({
    ciphertext: payload.ciphertext,
    payloadCrypto: payloadCryptoToProto(payload.payloadCrypto),
    plaintextLength: payload.plaintextLength,
  });
}

function encryptedPayloadFromProto(
  payload: WebTTYProto.rstream.webtty.protobuf.EncryptedPayload.$Properties,
): WebTTYEncryptedPayload {
  return {
    ciphertext: payload.ciphertext ?? new Uint8Array(),
    payloadCrypto: payloadCryptoFromProto(payload.payloadCrypto),
    plaintextLength: payload.plaintextLength ?? 0,
  };
}

function payloadCryptoCapabilities(
  payloadCrypto: WebTTYPayloadCrypto | undefined,
): WebTTYProto.rstream.webtty.protobuf.OpenCapability[] {
  if (payloadCrypto === undefined) return [];
  const configured = payloadCrypto.capabilities ?? [];
  const shouldAdvertiseEncryptedPayload =
    payloadCrypto.encryptStdin !== undefined ||
    payloadCrypto.decryptStdout !== undefined ||
    payloadCrypto.decryptStderr !== undefined ||
    payloadCrypto.sessionKeyGrant !== undefined;
  const capabilities: WebTTYOpenCapability[] = shouldAdvertiseEncryptedPayload
    ? ["encrypted-payload", ...configured]
    : configured;
  const seen = new Set<WebTTYOpenCapability>();
  return capabilities
    .filter((capability) => {
      if (seen.has(capability)) return false;
      seen.add(capability);
      return true;
    })
    .map(capabilityToProto);
}

function normalizeAttachConfig(
  attach: WebTTYAttachConfig | undefined,
  transport: WebTTYClientTransport,
): ResolvedWebTTYAttachConfig | undefined {
  if (attach === undefined) return undefined;
  const sessionId = attach.sessionId.trim();
  if (sessionId === "") {
    throw new Error("WebTTY attach session ID is required.");
  }
  const participantId = attach.participantId.trim();
  if (participantId === "") {
    throw new Error("WebTTY attach participant ID is required.");
  }
  if (attach.attachGrant.byteLength === 0) {
    throw new Error("WebTTY attach grant is required.");
  }
  const resolvedTransport = attach.transport ?? transport;
  attachTransportToProto(resolvedTransport);
  attachRoleToProto(attach.requestedRole ?? "spectator");
  const capabilities = attach.capabilities ?? ["read_stream"];
  attachCapabilitiesToProto(capabilities);
  return {
    attachGrant: new Uint8Array(attach.attachGrant),
    browserId: trimOptional(attach.browserId),
    capabilities: [...capabilities],
    deviceId: trimOptional(attach.deviceId),
    participantId,
    projectId: trimOptional(attach.projectId),
    requestedRole: attach.requestedRole ?? "spectator",
    serverId: trimOptional(attach.serverId),
    sessionId,
    transport: resolvedTransport,
    workspaceId: trimOptional(attach.workspaceId),
  };
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

function attachRoleToProto(
  role: WebTTYAttachRole,
): WebTTYProto.rstream.webtty.protobuf.AttachRole {
  switch (role) {
    case "spectator":
      return WebTTYProto.rstream.webtty.protobuf.AttachRole
        .ATTACH_ROLE_SPECTATOR;
    case "controller":
      return WebTTYProto.rstream.webtty.protobuf.AttachRole
        .ATTACH_ROLE_CONTROLLER;
    default:
      throw new Error(`Invalid WebTTY attach role "${String(role)}".`);
  }
}

function attachRoleTranscriptValue(
  role: WebTTYProto.rstream.webtty.protobuf.AttachRole,
): WebTTYAttachRole {
  switch (role) {
    case WebTTYProto.rstream.webtty.protobuf.AttachRole.ATTACH_ROLE_CONTROLLER:
      return "controller";
    case WebTTYProto.rstream.webtty.protobuf.AttachRole.ATTACH_ROLE_SPECTATOR:
    case WebTTYProto.rstream.webtty.protobuf.AttachRole.ATTACH_ROLE_UNSPECIFIED:
      return "spectator";
    default:
      return "spectator";
  }
}

function attachTransportToProto(
  transport: WebTTYClientTransport,
): WebTTYProto.rstream.webtty.protobuf.AttachTransport {
  switch (transport) {
    case "websocket":
      return WebTTYProto.rstream.webtty.protobuf.AttachTransport
        .ATTACH_TRANSPORT_WEBSOCKET;
    case "webtransport":
      return WebTTYProto.rstream.webtty.protobuf.AttachTransport
        .ATTACH_TRANSPORT_WEBTRANSPORT;
    default:
      throw new Error(
        `Invalid WebTTY attach transport "${String(transport)}".`,
      );
  }
}

function attachCapabilitiesToProto(
  capabilities: WebTTYAttachCapability[],
): WebTTYProto.rstream.webtty.protobuf.AttachCapability[] {
  return capabilities.map((capability) => {
    switch (capability) {
      case "read_stream":
        return WebTTYProto.rstream.webtty.protobuf.AttachCapability
          .ATTACH_CAPABILITY_READ_STREAM;
      case "request_control":
        return WebTTYProto.rstream.webtty.protobuf.AttachCapability
          .ATTACH_CAPABILITY_REQUEST_CONTROL;
      case "receive_control":
        return WebTTYProto.rstream.webtty.protobuf.AttachCapability
          .ATTACH_CAPABILITY_RECEIVE_CONTROL;
      default:
        throw new Error(
          `Invalid WebTTY attach capability "${String(capability)}".`,
        );
    }
  });
}

function resolveWebTTYClientTransport(
  url: string | URL,
  transport: WebTTYClientTransport | undefined,
): WebTTYClientTransport {
  if (transport !== undefined) return transport;
  const protocol =
    typeof url === "string" && url.includes("://")
      ? new URL(url).protocol
      : url instanceof URL
        ? url.protocol
        : "";
  switch (protocol.replace(":", "").toLowerCase()) {
    case "webtransport":
    case "wts":
      return "webtransport";
    default:
      return "websocket";
  }
}

function normalizeWebTransportURL(url: string | URL): string {
  const parsed = typeof url === "string" ? new URL(url) : new URL(url);
  switch (parsed.protocol) {
    case "https:":
      return parsed.toString();
    case "wss:":
    case "webtransport:":
    case "wts:":
      parsed.protocol = "https:";
      return parsed.toString();
    default:
      throw new Error(
        `Unsupported WebTransport WebTTY URL scheme "${parsed.protocol}".`,
      );
  }
}

function normalizeWebSocketURL(url: string | URL): string {
  const parsed = typeof url === "string" ? new URL(url) : new URL(url);
  switch (parsed.protocol) {
    case "ws:":
    case "wss:":
      return parsed.toString();
    case "http:":
      parsed.protocol = "ws:";
      return parsed.toString();
    case "https:":
      parsed.protocol = "wss:";
      return parsed.toString();
    default:
      throw new Error(
        `Unsupported WebSocket WebTTY URL scheme "${parsed.protocol}".`,
      );
  }
}

function resolveWebTransportConstructor(): WebTransportConstructorLike {
  const candidate = webTransportGlobal(globalThis)
    ? globalThis.WebTransport
    : undefined;
  if (candidate === undefined) {
    throw new Error("WebTransport is not available in this runtime.");
  }
  return candidate;
}

function webTransportGlobal(
  value: typeof globalThis,
): value is typeof globalThis & { WebTransport: WebTransportConstructorLike } {
  return "WebTransport" in value;
}

class WebSocketMessageConnection implements WebTTYMessageConnection {
  private readonly ws: WebSocket;
  private readonly handlers: {
    close: () => void;
    error: () => void;
    message: (event: MessageEvent) => void;
    open: () => void;
  };

  public constructor(
    url: string,
    handlers: {
      close: () => void;
      error: () => void;
      message: (data: unknown) => void;
      open: () => void;
    },
  ) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.handlers = {
      close: handlers.close,
      error: handlers.error,
      message: (event: MessageEvent) => handlers.message(event.data),
      open: handlers.open,
    };
    this.ws.addEventListener("open", this.handlers.open);
    this.ws.addEventListener("message", this.handlers.message);
    this.ws.addEventListener("error", this.handlers.error);
    this.ws.addEventListener("close", this.handlers.close);
  }

  public send(payload: Uint8Array<ArrayBufferLike>): void {
    this.ws.send(getWebSocketPayload(payload));
  }

  public close(): void {
    this.ws.removeEventListener("open", this.handlers.open);
    this.ws.removeEventListener("message", this.handlers.message);
    this.ws.removeEventListener("error", this.handlers.error);
    this.ws.removeEventListener("close", this.handlers.close);
    this.ws.close();
  }
}

class WebTransportMessageConnection implements WebTTYMessageConnection {
  private closed = false;
  private readBuffer = new Uint8Array();
  private writeQueue = Promise.resolve();

  private constructor(
    private readonly transport: WebTransportLike,
    private readonly stream: WebTransportBidirectionalStreamLike,
    private readonly writer: WritableStreamDefaultWriter<Uint8Array>,
    private readonly handlers: {
      close: () => void;
      error: (message: string) => void;
      message: (data: Uint8Array) => void;
    },
  ) {}

  public static async open(
    url: string,
    options: WebTTYWebTransportOptions | undefined,
    handlers: {
      close: () => void;
      error: (message: string) => void;
      message: (data: Uint8Array) => void;
    },
  ): Promise<WebTransportMessageConnection> {
    const Transport = resolveWebTransportConstructor();
    const transport = new Transport(url, options);
    await transport.ready;
    const stream = await transport.createBidirectionalStream();
    const writer = stream.writable.getWriter();
    const connection = new WebTransportMessageConnection(
      transport,
      stream,
      writer,
      handlers,
    );
    connection.startReadLoop();
    transport.closed.catch((error: unknown) => {
      if (!connection.closed) {
        handlers.error(`WebTransport closed: ${getErrorMessage(error)}`);
      }
    });
    return connection;
  }

  public send(payload: Uint8Array<ArrayBufferLike>): void {
    if (this.closed) return;
    const frame = getFramePayload(payload);
    this.writeQueue = this.writeQueue
      .then(() => this.writer.write(frame))
      .catch((error: unknown) => {
        if (!this.closed) {
          this.handlers.error(
            `WebTransport write failed: ${getErrorMessage(error)}`,
          );
        }
      });
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.writer.releaseLock();
    this.transport.close({ closeCode: 0, reason: "closed" });
  }

  private startReadLoop(): void {
    void this.readLoop().catch((error: unknown) => {
      if (!this.closed) {
        this.handlers.error(
          `WebTransport read failed: ${getErrorMessage(error)}`,
        );
      }
    });
  }

  private async readLoop(): Promise<void> {
    const reader = this.stream.readable.getReader();
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) {
          if (!this.closed) this.handlers.close();
          return;
        }
        this.appendReadChunk(result.value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  private appendReadChunk(chunk: Uint8Array): void {
    const next = new Uint8Array(this.readBuffer.byteLength + chunk.byteLength);
    next.set(this.readBuffer);
    next.set(chunk, this.readBuffer.byteLength);
    this.readBuffer = next;
    for (;;) {
      if (this.readBuffer.byteLength < 4) return;
      const view = new DataView(
        this.readBuffer.buffer,
        this.readBuffer.byteOffset,
        this.readBuffer.byteLength,
      );
      const size = view.getUint32(0, false);
      if (this.readBuffer.byteLength < 4 + size) return;
      const payload = this.readBuffer.slice(4, 4 + size);
      this.readBuffer = this.readBuffer.slice(4 + size);
      this.handlers.message(payload);
    }
  }
}

/**
 * WebTTY client for managing remote execution sessions.
 */
export class WebTTY {
  private connection: WebTTYMessageConnection | null = null;
  private connectionState: ConnectionState = "preparing";
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly clientConfig: ResolvedWebTTYClientConfig;
  private readonly execConfig: ResolvedWebTTYExecutionConfig;
  private readonly events: WebTTYEvents;
  private receiveQueue: Promise<void> | null = null;

  /**
   * Creates a new WebTTY instance.
   *
   * @param clientConfig - WebTTY connection configuration.
   * @param execConfig - Execution parameters.
   * @param events - Event callbacks for the session.
   */
  constructor(
    clientConfig: WebTTYClientConfig,
    execConfig?: WebTTYExecutionConfig,
    events?: WebTTYEvents,
  ) {
    const transport = resolveWebTTYClientTransport(
      clientConfig.url,
      clientConfig.transport,
    );
    if (
      clientConfig.attach === undefined &&
      execConfig?.payloadCrypto?.sessionKeyGrant !== undefined
    ) {
      if (clientConfig.expectedServerIdentity === undefined) {
        throw new Error(
          "WebTTY E2E requires a known server endpoint identity.",
        );
      }
      if (clientConfig.endpointIdentity === undefined) {
        throw new Error("WebTTY E2E requires a client endpoint identity.");
      }
    }
    this.clientConfig = {
      attach: normalizeAttachConfig(clientConfig.attach, transport),
      clientBrowserId: clientConfig.clientBrowserId,
      clientCredential: clientConfig.clientCredential,
      clientDeviceId: clientConfig.clientDeviceId,
      clientPrincipalId: clientConfig.clientPrincipalId,
      endpointIdentity: clientConfig.endpointIdentity,
      expectedServerIdentity: clientConfig.expectedServerIdentity,
      heartbeatIntervalMs: clientConfig.heartbeatIntervalMs ?? 5000,
      sendHeartbeat: clientConfig.sendHeartbeat ?? true,
      transport,
      url: clientConfig.url,
      webTransportOptions: clientConfig.webTransportOptions,
    };
    this.execConfig = {
      allocateTty: execConfig?.allocateTty ?? true,
      cmdArgs: execConfig?.cmdArgs,
      envVars: execConfig?.envVars ?? [],
      interactive: execConfig?.interactive ?? true,
      payloadCrypto: execConfig?.payloadCrypto,
      username: execConfig?.username,
      workdir: execConfig?.workdir,
    };
    this.events = events || {};
  }

  /**
   * Connects to the WebTTY server and starts the session.
   */
  public connect(): void {
    if (this.connectionState !== "preparing") {
      throw new Error("Invalid state for connect().");
    }
    this.connectionState = "connecting";
    if (this.clientConfig.transport === "webtransport") {
      void this.connectWebTransport(
        normalizeWebTransportURL(this.clientConfig.url),
      );
      return;
    }
    const wsUrl = normalizeWebSocketURL(this.clientConfig.url);
    this.connection = new WebSocketMessageConnection(wsUrl, {
      close: this.handleClose,
      error: this.handleError,
      message: this.handleConnectionMessage,
      open: this.handleOpen,
    });
  }

  /**
   * Sends data to the remote server's STDIN.
   *
   * @param data - The data to send.
   */
  public writeStdin(data: Uint8Array): void {
    this.assertCanWriteStdin();
    const encrypt = this.execConfig.payloadCrypto?.encryptStdin;
    if (encrypt === undefined) {
      this.sendStdinPayload({ data });
      return;
    }
    const encrypted = encrypt(data);
    if (isPromiseLike(encrypted)) {
      encrypted.catch(() => undefined);
      throw new Error(
        "Async WebTTY payload crypto requires writeStdinAsync().",
      );
    }
    this.sendStdinPayload({
      encryptedData: encryptedPayloadToProto(encrypted),
    });
  }

  /**
   * Sends data to STDIN and awaits asynchronous payload crypto hooks when configured.
   *
   * @param data - The data to send.
   */
  public async writeStdinAsync(data: Uint8Array): Promise<void> {
    this.assertCanWriteStdin();
    const encrypt = this.execConfig.payloadCrypto?.encryptStdin;
    if (encrypt === undefined) {
      this.sendStdinPayload({ data });
      return;
    }
    const encrypted = await encrypt(data);
    this.sendStdinPayload({
      encryptedData: encryptedPayloadToProto(encrypted),
    });
  }

  private assertCanWriteStdin(): void {
    if (this.connectionState !== "connected" || !this.connection) {
      throw new Error("Invalid state for writeStdin().");
    }
    if (this.execConfig.interactive === false) {
      throw new Error("STDIN is unavailable in non-interactive mode.");
    }
  }

  private sendStdinPayload(
    payload:
      | { data: Uint8Array; encryptedData?: never }
      | {
          data?: never;
          encryptedData: WebTTYProto.rstream.webtty.protobuf.EncryptedPayload;
        },
  ): void {
    this.send(
      new WebTTYProto.rstream.webtty.protobuf.Message({
        data: new WebTTYProto.rstream.webtty.protobuf.Data({
          type: WebTTYProto.rstream.webtty.protobuf.Data.Type.TYPE_STDIN,
          ...payload,
        }),
      }),
    );
  }

  /**
   * Closes the remote STDIN stream (EOF).
   */
  public closeStdin(): void {
    if (this.connectionState !== "connected" || !this.connection) {
      throw new Error("Invalid state for closeStdin().");
    }
    if (this.execConfig.interactive === false) {
      throw new Error("STDIN is unavailable in non-interactive mode.");
    }
    this.send(
      new WebTTYProto.rstream.webtty.protobuf.Message({
        data: new WebTTYProto.rstream.webtty.protobuf.Data({
          type: WebTTYProto.rstream.webtty.protobuf.Data.Type.TYPE_STDIN,
          eos: new WebTTYProto.rstream.webtty.protobuf.EndOfStream(),
        }),
      }),
    );
  }

  /**
   * Sends a "resize" request to the remote TTY with the provided rows and columns (and optional pixel sizes).
   */
  public resize(rows: number, cols: number, xpixel = 0, ypixel = 0): void {
    if (this.connectionState !== "connected" || !this.connection) {
      throw new Error("Invalid state for resize().");
    }
    if (this.execConfig.allocateTty === false) {
      throw new Error("Resize is unavailable in non-TTY mode.");
    }
    const parameter = new WebTTYProto.rstream.webtty.protobuf.TerminalSize({
      row: rows,
      col: cols,
      xpixel,
      ypixel,
    });
    const payload = new WebTTYProto.rstream.webtty.protobuf.Parameter({
      terminalSize: parameter,
    });
    const msg = new WebTTYProto.rstream.webtty.protobuf.Message({
      parameter: payload,
    });
    this.send(msg);
  }

  /**
   * Terminates the WebTTY session immediately.
   */
  public disconnect(): void {
    this.close("Session terminated by client.");
  }

  // ---------------------------------------------------------------------------------------------
  // Internal Handlers
  // ---------------------------------------------------------------------------------------------

  private handleOpen = (): void => {
    if (this.connectionState !== "connecting") {
      return;
    }
    if (this.clientConfig.expectedServerIdentity !== undefined) {
      if (this.clientConfig.transport === "webtransport") {
        this.sendClientHello();
      }
      return;
    }
    if (this.clientConfig.attach !== undefined) {
      void this.sendAttach();
      return;
    }
    this.sendOpen();
  };

  private sendClientHello(): void {
    this.send(
      new WebTTYProto.rstream.webtty.protobuf.Message({
        clientHello: new WebTTYProto.rstream.webtty.protobuf.ClientHello({
          protocolVersion:
            WebTTYProto.rstream.webtty.protobuf.ProtocolVersion
              .PROTOCOL_VERSION_WEBTTY_1,
        }),
      }),
    );
  }

  private async sendAttach(): Promise<void> {
    const attach = this.clientConfig.attach;
    if (attach === undefined) {
      throw new Error("WebTTY attach config is required.");
    }
    const message = new WebTTYProto.rstream.webtty.protobuf.Attach({
      attachGrant: attach.attachGrant,
      browserId: stringValue(attach.browserId),
      capabilities: attachCapabilitiesToProto(attach.capabilities),
      deviceId: stringValue(attach.deviceId),
      participantId: attach.participantId,
      requestedRole: attachRoleToProto(attach.requestedRole),
      sessionId: attach.sessionId,
      transport: attachTransportToProto(attach.transport),
    });
    try {
      message.clientProof = await this.clientProofForAttach(message);
    } catch (error: unknown) {
      this.close(`Failed to attach session: ${getErrorMessage(error)}`);
      return;
    }
    this.send(
      new WebTTYProto.rstream.webtty.protobuf.Message({
        attach: message,
      }),
    );
  }

  private sendOpen(
    serverHello?: WebTTYProto.rstream.webtty.protobuf.ServerHello.$Properties,
  ): void {
    const opts = new WebTTYProto.rstream.webtty.protobuf.Options({
      interactive: this.execConfig.interactive,
      allocateTty: this.execConfig.allocateTty,
      sendHeartbeat: this.clientConfig.sendHeartbeat,
    });
    const config = new WebTTYProto.rstream.webtty.protobuf.Config({
      options: opts,
      cmdArgs: this.execConfig.cmdArgs,
      envVars: this.execConfig.envVars.map(
        (e) =>
          new WebTTYProto.rstream.webtty.protobuf.Environment({
            key: e.key,
            value: e.value,
          }),
      ),
      workdir: this.execConfig.workdir
        ? new WebTTYProto.rstream.webtty.protobuf.Workdir({
            value: this.execConfig.workdir,
          })
        : undefined,
      username:
        typeof this.execConfig.username === "string"
          ? new WebTTYProto.rstream.webtty.protobuf.Username({
              name: this.execConfig.username,
            })
          : this.execConfig.username !== undefined
            ? new WebTTYProto.rstream.webtty.protobuf.Username({
                id: this.execConfig.username,
              })
            : undefined,
    });
    const open = new WebTTYProto.rstream.webtty.protobuf.Open({
      capabilities: payloadCryptoCapabilities(this.execConfig.payloadCrypto),
      config,
      sessionKeyGrant: sessionKeyGrantToProto(
        this.execConfig.payloadCrypto?.sessionKeyGrant,
      ),
    });
    if (
      serverHello?.authRequirement ===
      WebTTYProto.rstream.webtty.protobuf.AuthRequirement
        .AUTH_REQUIREMENT_CLIENT_PROOF
    ) {
      void this.clientProofForOpen(open, serverHello)
        .then((clientProof) => {
          open.clientProof = clientProof;
          this.sendOpenMessage(open);
        })
        .catch((error: unknown) => {
          this.close(`Failed to open session: ${getErrorMessage(error)}`);
        });
      return;
    }
    this.sendOpenMessage(open);
  }

  private sendOpenMessage(
    open: WebTTYProto.rstream.webtty.protobuf.Open,
  ): void {
    this.send(
      new WebTTYProto.rstream.webtty.protobuf.Message({
        open,
      }),
    );
  }

  private async processServerHello(
    serverHello: WebTTYProto.rstream.webtty.protobuf.ServerHello.$Properties,
  ): Promise<void> {
    if (this.clientConfig.expectedServerIdentity === undefined) {
      this.close(
        "WebTTY server requires authenticated E2E; configure a known server endpoint identity and a client endpoint identity before opening the session.",
      );
      return;
    }
    if (this.clientConfig.attach !== undefined) {
      this.close("Server hello is not supported for attach sessions yet.");
      return;
    }
    const ok = await this.verifyServerHello(serverHello);
    if (!ok) {
      this.close("WebTTY server proof verification failed.");
      return;
    }
    this.sendOpen(serverHello);
  }

  private async verifyServerHello(
    serverHello: WebTTYProto.rstream.webtty.protobuf.ServerHello.$Properties,
  ): Promise<boolean> {
    const expected = this.clientConfig.expectedServerIdentity;
    if (expected === undefined) return true;
    const actual = serverHello.serverIdentity;
    const proof = serverHello.serverProof;
    if (
      actual === undefined ||
      actual === null ||
      proof === undefined ||
      proof === null
    ) {
      return false;
    }
    if (
      !bytesEqual(actual.signingKeyId, expected.signingKeyId) ||
      !bytesEqual(actual.signingPublicKey, expected.signingPublicKey) ||
      !bytesEqual(actual.encryptionKeyId, expected.encryptionKeyId) ||
      !bytesEqual(actual.encryptionPublicKey, expected.encryptionPublicKey)
    ) {
      return false;
    }
    const transcript = {
      authRequirement: authRequirementFromProto(serverHello.authRequirement),
      keyEnvelopeSuites: (serverHello.keyEnvelopeSuites ?? [])
        .map(keyEnvelopeSuiteFromProto)
        .filter(
          (value): value is WebTTYKeyEnvelopeSuite => value !== undefined,
        ),
      payloadSuites: (serverHello.payloadSuites ?? [])
        .map(payloadCipherSuiteFromProto)
        .filter(
          (value): value is WebTTYPayloadCipherSuite => value !== undefined,
        ),
      projectId: optionalString(serverHello.projectId),
      protocolVersion: "webtty-1" as const,
      serverEncryptionKeyId: optionalBytes(actual.encryptionKeyId),
      serverId: optionalString(serverHello.serverId),
      serverNonce: optionalBytes(serverHello.sessionNonce),
      serverSigningKeyId: optionalBytes(actual.signingKeyId),
      sessionId: optionalString(serverHello.sessionId),
      signatureSuites: (serverHello.signatureSuites ?? [])
        .map(signatureSuiteFromProto)
        .filter((value): value is "ecdsa-p256-sha256" => value !== undefined),
      transport: this.clientConfig.transport,
      workspaceId: optionalString(serverHello.workspaceId),
    };
    if (
      !bytesEqual(
        proof.transcriptHash,
        await hashWebTTYServerProofTranscript(transcript),
      )
    ) {
      return false;
    }
    return verifyWebTTYServerProofTranscript(
      actual.signingPublicKey ?? new Uint8Array(),
      transcript,
      proof.signature ?? new Uint8Array(),
    );
  }

  private async clientProofForOpen(
    open: WebTTYProto.rstream.webtty.protobuf.Open,
    serverHello:
      | WebTTYProto.rstream.webtty.protobuf.ServerHello.$Properties
      | undefined,
  ): Promise<WebTTYProto.rstream.webtty.protobuf.ClientProof | undefined> {
    if (
      serverHello?.authRequirement !==
      WebTTYProto.rstream.webtty.protobuf.AuthRequirement
        .AUTH_REQUIREMENT_CLIENT_PROOF
    ) {
      return undefined;
    }
    if (this.clientConfig.endpointIdentity === undefined) {
      throw new Error(
        "WebTTY server requires a client proof, but no client endpoint identity is configured.",
      );
    }
    const signing = this.clientConfig.endpointIdentity.signing;
    const issuedAt = new Date();
    issuedAt.setMilliseconds(0);
    const expiresAt = new Date(issuedAt.getTime() + 30_000);
    const sessionKeyGrantHash = await hashWebTTYSessionKeyGrant(
      open.sessionKeyGrant ?? undefined,
    );
    const commandConfigHash = await hashWebTTYConfig(open.config ?? undefined);
    const serverIdentity = serverHello.serverIdentity;
    if (serverIdentity === undefined || serverIdentity === null) {
      throw new Error("WebTTY server hello is missing server identity.");
    }
    const clientPrincipalId = trimOptional(this.clientConfig.clientPrincipalId);
    const clientCredential = this.clientConfig.clientCredential;
    const transcript = {
      authRequirement: "client-proof" as const,
      clientCredentialHash: await hashWebTTYClientCredential(clientCredential),
      clientPrincipalId,
      clientSigningKeyId: signing.keyId,
      commandConfigHash,
      expiresAt: expiresAt.toISOString().replace(".000Z", "Z"),
      issuedAt: issuedAt.toISOString().replace(".000Z", "Z"),
      keyEnvelopeSuite: "hpke-x25519-hkdf-sha256-aes-256-gcm" as const,
      payloadSuite: "aes-256-gcm" as const,
      projectId: optionalString(serverHello.projectId),
      protocolVersion: "webtty-1" as const,
      serverEncryptionKeyId: optionalBytes(serverIdentity.encryptionKeyId),
      serverId: optionalString(serverHello.serverId),
      serverNonce: optionalBytes(serverHello.sessionNonce),
      serverSigningKeyId: optionalBytes(serverIdentity.signingKeyId),
      sessionId: optionalString(serverHello.sessionId),
      sessionKeyGrantHash,
      transport: this.clientConfig.transport,
      workspaceId: optionalString(serverHello.workspaceId),
    };
    const proof = await signWebTTYClientProofTranscript(
      signing.privateKey,
      transcript,
    );
    return new WebTTYProto.rstream.webtty.protobuf.ClientProof({
      browserId: stringValue(this.clientConfig.clientBrowserId),
      credential: bytesValue(clientCredential),
      deviceId: stringValue(this.clientConfig.clientDeviceId),
      expiresAt: transcript.expiresAt,
      issuedAt: transcript.issuedAt,
      principalId: stringValue(clientPrincipalId),
      signature: proof.signature,
      signatureSuite:
        WebTTYProto.rstream.webtty.protobuf.SignatureSuite
          .SIGNATURE_SUITE_ECDSA_P256_SHA256,
      signingKeyId: signing.keyId,
      signingPublicKey: signing.publicKey,
      transcriptHash: proof.transcriptHash,
    });
  }

  private async clientProofForAttach(
    attach: WebTTYProto.rstream.webtty.protobuf.Attach,
  ): Promise<WebTTYProto.rstream.webtty.protobuf.ClientProof | undefined> {
    const clientCredential = this.clientConfig.clientCredential;
    if (
      clientCredential === undefined &&
      this.clientConfig.endpointIdentity === undefined
    ) {
      return undefined;
    }
    if (this.clientConfig.endpointIdentity === undefined) {
      throw new Error(
        "WebTTY attach client proof requires a client endpoint identity.",
      );
    }
    const attachConfig = this.clientConfig.attach;
    if (attachConfig === undefined) {
      throw new Error("WebTTY attach config is required.");
    }
    const signing = this.clientConfig.endpointIdentity.signing;
    const issuedAt = new Date();
    issuedAt.setMilliseconds(0);
    const expiresAt = new Date(issuedAt.getTime() + 30_000);
    const clientPrincipalId = trimOptional(this.clientConfig.clientPrincipalId);
    const transcript = {
      attachGrantHash: await hashWebTTYAttachGrant(attach.attachGrant),
      authRequirement: "client-proof" as const,
      clientCredentialHash: await hashWebTTYClientCredential(clientCredential),
      clientPrincipalId,
      clientSigningKeyId: signing.keyId,
      expiresAt: expiresAt.toISOString().replace(".000Z", "Z"),
      issuedAt: issuedAt.toISOString().replace(".000Z", "Z"),
      keyEnvelopeSuite: "hpke-x25519-hkdf-sha256-aes-256-gcm" as const,
      payloadSuite: "aes-256-gcm" as const,
      projectId: attachConfig.projectId,
      protocolVersion: "webtty-1" as const,
      requestedRole: attachRoleTranscriptValue(attach.requestedRole),
      serverId: attachConfig.serverId,
      sessionId: attach.sessionId,
      transport: attachConfig.transport,
      workspaceId: attachConfig.workspaceId,
    };
    const proof = await signWebTTYClientProofTranscript(
      signing.privateKey,
      transcript,
    );
    return new WebTTYProto.rstream.webtty.protobuf.ClientProof({
      browserId: stringValue(this.clientConfig.clientBrowserId),
      credential: bytesValue(clientCredential),
      deviceId: stringValue(this.clientConfig.clientDeviceId),
      expiresAt: transcript.expiresAt,
      issuedAt: transcript.issuedAt,
      principalId: stringValue(clientPrincipalId),
      signature: proof.signature,
      signatureSuite:
        WebTTYProto.rstream.webtty.protobuf.SignatureSuite
          .SIGNATURE_SUITE_ECDSA_P256_SHA256,
      signingKeyId: signing.keyId,
      signingPublicKey: signing.publicKey,
      transcriptHash: proof.transcriptHash,
    });
  }

  private async connectWebTransport(url: string): Promise<void> {
    try {
      const connection = await WebTransportMessageConnection.open(
        url,
        this.clientConfig.webTransportOptions,
        {
          close: this.handleClose,
          error: this.handleTransportError,
          message: this.handleConnectionMessage,
        },
      );
      if (this.connectionState !== "connecting") {
        connection.close();
        return;
      }
      this.connection = connection;
      this.handleOpen();
    } catch (error) {
      this.close(`WebTransport connection failed: ${getErrorMessage(error)}`);
    }
  }

  private handleConnectionMessage = (data: unknown): void => {
    const run = () => this.processMessage(data);
    if (this.receiveQueue) {
      this.trackReceiveQueue(this.receiveQueue.then(run, run));
      return;
    }
    const result = run();
    if (isPromiseLike(result)) {
      this.trackReceiveQueue(result);
    }
  };

  private trackReceiveQueue(promise: Promise<void>): void {
    const queued = promise
      .catch((error: unknown) => {
        this.close(`Failed to decode message: ${getErrorMessage(error)}`);
      })
      .finally(() => {
        if (this.receiveQueue === queued) this.receiveQueue = null;
      });
    this.receiveQueue = queued;
  }

  private processMessage(data: unknown): void | Promise<void> {
    if (!data) return;
    if (
      this.connectionState === "preparing" ||
      this.connectionState === "closed"
    )
      return;
    try {
      const message = WebTTYProto.rstream.webtty.protobuf.Message.decode(
        messagePayloadBytes(data),
      );
      if (message.error) {
        this.close(`Server error (${message.error.msg})`);
      } else if (message.ack) {
        if (this.connectionState === "connecting") {
          this.connectionState = "connected";
          this.events.onConnect?.();
          if (this.clientConfig.sendHeartbeat) {
            this.heartbeatTimer = setInterval(
              () => this.sendHeartbeat(),
              this.clientConfig.heartbeatIntervalMs,
            );
          }
        } else {
          this.close("Unexpected ACK message.");
        }
      } else if (message.close) {
        this.close(message.close.returnCode ?? 0);
      } else if (message.data) {
        if (this.connectionState !== "connected") {
          this.close("Unexpected data message.");
          return;
        }
        return this.processDataMessage(message.data);
      } else if (message.attach) {
        this.close("Unexpected attach message.");
      } else if (message.serverHello) {
        if (this.connectionState !== "connecting") {
          this.close("Unexpected server hello message.");
          return;
        }
        return this.processServerHello(message.serverHello);
      } else if (message.protocolError) {
        this.close(`Protocol error (${message.protocolError.msg})`);
      }
    } catch (error) {
      this.close(`Failed to decode message: ${getErrorMessage(error)}`);
    }
  }

  private processDataMessage(
    data: WebTTYProto.rstream.webtty.protobuf.Data.$Properties,
  ): void | Promise<void> {
    if (
      data.type === WebTTYProto.rstream.webtty.protobuf.Data.Type.TYPE_STDOUT
    ) {
      if (data.data) {
        this.events.onStdout?.(data.data);
      }
      if (data.encryptedData) {
        const decrypted = this.decryptData("stdout", data.encryptedData);
        if (isPromiseLike(decrypted)) {
          return decrypted.then((chunk) => {
            if (chunk !== null) this.events.onStdout?.(chunk);
          });
        }
        if (decrypted === null) return;
        this.events.onStdout?.(decrypted);
      }
      if (data.eos) {
        this.events.onStdoutEos?.();
      }
    } else if (
      data.type === WebTTYProto.rstream.webtty.protobuf.Data.Type.TYPE_STDERR
    ) {
      if (data.data) {
        this.events.onStderr?.(data.data);
      }
      if (data.encryptedData) {
        const decrypted = this.decryptData("stderr", data.encryptedData);
        if (isPromiseLike(decrypted)) {
          return decrypted.then((chunk) => {
            if (chunk !== null) this.events.onStderr?.(chunk);
          });
        }
        if (decrypted === null) return;
        this.events.onStderr?.(decrypted);
      }
      if (data.eos) {
        this.events.onStderrEos?.();
      }
    }
  }

  private decryptData(
    stream: "stderr" | "stdout",
    payload: WebTTYProto.rstream.webtty.protobuf.EncryptedPayload.$Properties,
  ): MaybePromise<Uint8Array | null> {
    const decrypt =
      stream === "stdout"
        ? this.execConfig.payloadCrypto?.decryptStdout
        : this.execConfig.payloadCrypto?.decryptStderr;
    if (decrypt === undefined) {
      this.close(`Encrypted WebTTY ${stream} payload requires a decrypt hook.`);
      return null;
    }
    return decrypt(encryptedPayloadFromProto(payload));
  }

  private handleClose = (): void => {
    if (this.connectionState !== "closed") {
      const message = `${this.clientConfig.transport} was closed unexpectedly.`;
      if (this.receiveQueue) {
        this.trackReceiveQueue(
          this.receiveQueue.then(
            () => {
              if (this.connectionState !== "closed") this.close(message);
            },
            () => {
              if (this.connectionState !== "closed") this.close(message);
            },
          ),
        );
        return;
      }
      this.close(message);
    }
  };

  private handleError = (): void => {
    if (this.connectionState !== "closed") {
      this.close(`${this.clientConfig.transport} encountered an error.`);
    }
  };

  private handleTransportError = (message: string): void => {
    if (this.connectionState !== "closed") {
      this.close(message);
    }
  };

  private sendHeartbeat(): void {
    this.send(
      new WebTTYProto.rstream.webtty.protobuf.Message({
        heartbeat: new WebTTYProto.rstream.webtty.protobuf.Heartbeat(),
      }),
    );
  }

  private send(message: WebTTYProto.rstream.webtty.protobuf.Message): void {
    if (!this.connection) return;
    if (
      this.connectionState === "preparing" ||
      this.connectionState === "closed"
    )
      return;
    const buffer =
      WebTTYProto.rstream.webtty.protobuf.Message.encode(message).finish();
    this.connection.send(buffer);
  }

  /**
   * Closes the WebTTY session and fires exactly one of:
   *   - onComplete(exitCode)       // if a number is passed
   *   - onError(errorMessage)      // if a string is passed
   * If no argument is given, treat as an unknown error scenario.
   */
  private close(result?: number | string): void {
    if (this.connectionState === "closed") {
      return;
    }
    this.connectionState = "closed";
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.connection) {
      this.connection.close();
      this.connection = null;
    }
    if (typeof result === "number") {
      this.events.onComplete?.(result);
    } else if (typeof result === "string") {
      this.events.onError?.(result);
    } else {
      this.events.onError?.("Connection closed without a known reason.");
    }
  }
}
