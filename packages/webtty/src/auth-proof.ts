// See LICENSE file in the project root for license information.

import * as WebTTYProto from "../.generated/protobuf/webtty";
import type { WebTTYKeyEnvelopeSuite } from "./webtty";
import type { WebTTYPayloadCipherSuite } from "./webtty";

const clientAuthTranscriptDomain = "rstream-webtty-client-auth-v1";
const serverAuthTranscriptDomain = "rstream-webtty-server-auth-v1";
const signingKeyIDDomain = "rstream-webtty-signing-key-id-v1";

export type WebTTYSignatureSuite = "ecdsa-p256-sha256";
export type WebTTYAuthRequirement = "none" | "client-proof";

export interface WebTTYClientProofTranscript {
  attachGrantHash?: Uint8Array;
  authRequirement?: WebTTYAuthRequirement;
  clientCredentialHash?: Uint8Array;
  clientPrincipalId?: string;
  clientSigningKeyId?: Uint8Array;
  commandConfigHash?: Uint8Array;
  expiresAt?: string;
  issuedAt?: string;
  keyEnvelopeSuite?: WebTTYKeyEnvelopeSuite;
  payloadSuite?: WebTTYPayloadCipherSuite;
  projectId?: string;
  protocolVersion?: "webtty-1";
  requestedRole?: string;
  serverEncryptionKeyId?: Uint8Array;
  serverId?: string;
  serverNonce?: Uint8Array;
  serverSigningKeyId?: Uint8Array;
  sessionId?: string;
  sessionKeyGrantHash?: Uint8Array;
  transport?: string;
  workspaceId?: string;
}

export interface WebTTYServerProofTranscript {
  authRequirement?: WebTTYAuthRequirement;
  keyEnvelopeSuites?: WebTTYKeyEnvelopeSuite[];
  payloadSuites?: WebTTYPayloadCipherSuite[];
  projectId?: string;
  protocolVersion?: "webtty-1";
  serverEncryptionKeyId?: Uint8Array;
  serverId?: string;
  serverNonce?: Uint8Array;
  serverSigningKeyId?: Uint8Array;
  sessionId?: string;
  signatureSuites?: WebTTYSignatureSuite[];
  transport?: string;
  workspaceId?: string;
}

export interface WebTTYSigningIdentity {
  keyId: Uint8Array;
  privateKey: CryptoKey | Uint8Array;
  publicKey: Uint8Array;
}

export interface WebTTYProofSignature {
  signature: Uint8Array;
  transcriptHash: Uint8Array;
}

export function webTTYClientProofTranscriptBytes(
  transcript: WebTTYClientProofTranscript,
): Uint8Array {
  return concat(
    lengthPrefixed(utf8(clientAuthTranscriptDomain)),
    be32(protocolVersionCode(transcript.protocolVersion)),
    lengthPrefixedString(transcript.transport),
    lengthPrefixedString(transcript.workspaceId),
    lengthPrefixedString(transcript.projectId),
    lengthPrefixedString(transcript.serverId),
    lengthPrefixedString(transcript.sessionId),
    lengthPrefixed(transcript.serverSigningKeyId),
    lengthPrefixed(transcript.serverEncryptionKeyId),
    lengthPrefixed(transcript.serverNonce),
    be32(authRequirementCode(transcript.authRequirement)),
    be32(payloadSuiteCode(transcript.payloadSuite)),
    be32(keyEnvelopeSuiteCode(transcript.keyEnvelopeSuite)),
    lengthPrefixed(transcript.sessionKeyGrantHash),
    lengthPrefixed(transcript.commandConfigHash),
    lengthPrefixed(transcript.attachGrantHash),
    lengthPrefixedString(transcript.requestedRole),
    lengthPrefixedString(transcript.clientPrincipalId),
    lengthPrefixed(transcript.clientSigningKeyId),
    lengthPrefixed(transcript.clientCredentialHash),
    lengthPrefixedString(transcript.issuedAt),
    lengthPrefixedString(transcript.expiresAt),
  );
}

export async function hashWebTTYClientProofTranscript(
  transcript: WebTTYClientProofTranscript,
): Promise<Uint8Array> {
  return sha256(webTTYClientProofTranscriptBytes(transcript));
}

export async function hashWebTTYClientCredential(
  credential?: Uint8Array,
): Promise<Uint8Array> {
  return sha256(credential ?? new Uint8Array());
}

export async function hashWebTTYAttachGrant(
  grant?: Uint8Array,
): Promise<Uint8Array> {
  return sha256(grant ?? new Uint8Array());
}

export async function generateWebTTYSigningIdentity(): Promise<WebTTYSigningIdentity> {
  const pair = await globalThis.crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicKey = new Uint8Array(
    await globalThis.crypto.subtle.exportKey("spki", pair.publicKey),
  );
  const privateKey = new Uint8Array(
    await globalThis.crypto.subtle.exportKey("pkcs8", pair.privateKey),
  );
  return {
    keyId: await webTTYSigningKeyID(publicKey),
    privateKey,
    publicKey,
  };
}

export async function webTTYSigningKeyID(
  publicKey: Uint8Array,
): Promise<Uint8Array> {
  return sha256(concat(utf8(signingKeyIDDomain), publicKey));
}

export async function signWebTTYClientProofTranscript(
  privateKey: CryptoKey | Uint8Array,
  transcript: WebTTYClientProofTranscript,
): Promise<WebTTYProofSignature> {
  const transcriptBytes = webTTYClientProofTranscriptBytes(transcript);
  return signWebTTYProofTranscript(
    privateKey,
    transcriptBytes,
    await sha256(transcriptBytes),
  );
}

export async function verifyWebTTYClientProofTranscript(
  publicKey: Uint8Array,
  transcript: WebTTYClientProofTranscript,
  signature: Uint8Array,
): Promise<boolean> {
  return verifyWebTTYProofTranscript(
    publicKey,
    webTTYClientProofTranscriptBytes(transcript),
    signature,
  );
}

export async function signWebTTYServerProofTranscript(
  privateKey: CryptoKey | Uint8Array,
  transcript: WebTTYServerProofTranscript,
): Promise<WebTTYProofSignature> {
  const transcriptBytes = webTTYServerProofTranscriptBytes(transcript);
  return signWebTTYProofTranscript(
    privateKey,
    transcriptBytes,
    await sha256(transcriptBytes),
  );
}

export async function verifyWebTTYServerProofTranscript(
  publicKey: Uint8Array,
  transcript: WebTTYServerProofTranscript,
  signature: Uint8Array,
): Promise<boolean> {
  return verifyWebTTYProofTranscript(
    publicKey,
    webTTYServerProofTranscriptBytes(transcript),
    signature,
  );
}

export async function hashWebTTYConfig(
  config?: WebTTYProto.rstream.webtty.protobuf.Config.$Properties,
): Promise<Uint8Array> {
  if (config === undefined) return sha256(new Uint8Array());
  return sha256(
    WebTTYProto.rstream.webtty.protobuf.Config.encode(
      normalizeConfig(config),
    ).finish(),
  );
}

export async function hashWebTTYSessionKeyGrant(
  grant?: WebTTYProto.rstream.webtty.protobuf.SessionKeyGrant.$Properties,
): Promise<Uint8Array> {
  if (grant === undefined) return sha256(new Uint8Array());
  return sha256(
    WebTTYProto.rstream.webtty.protobuf.SessionKeyGrant.encode(
      normalizeSessionKeyGrant(grant),
    ).finish(),
  );
}

export function webTTYServerProofTranscriptBytes(
  transcript: WebTTYServerProofTranscript,
): Uint8Array {
  return concat(
    lengthPrefixed(utf8(serverAuthTranscriptDomain)),
    be32(protocolVersionCode(transcript.protocolVersion)),
    lengthPrefixedString(transcript.transport),
    lengthPrefixedString(transcript.workspaceId),
    lengthPrefixedString(transcript.projectId),
    lengthPrefixedString(transcript.serverId),
    lengthPrefixedString(transcript.sessionId),
    lengthPrefixed(transcript.serverSigningKeyId),
    lengthPrefixed(transcript.serverEncryptionKeyId),
    lengthPrefixed(transcript.serverNonce),
    be32(authRequirementCode(transcript.authRequirement)),
    payloadSuitesBytes(transcript.payloadSuites),
    keyEnvelopeSuitesBytes(transcript.keyEnvelopeSuites),
    signatureSuitesBytes(transcript.signatureSuites),
  );
}

export async function hashWebTTYServerProofTranscript(
  transcript: WebTTYServerProofTranscript,
): Promise<Uint8Array> {
  return sha256(webTTYServerProofTranscriptBytes(transcript));
}

function protocolVersionCode(value: "webtty-1" | undefined): number {
  return value === "webtty-1" || value === undefined ? 1 : 0;
}

function authRequirementCode(value: WebTTYAuthRequirement | undefined): number {
  if (value === "none") return 1;
  if (value === "client-proof" || value === undefined) return 2;
  return 0;
}

function payloadSuiteCode(value: WebTTYPayloadCipherSuite | undefined): number {
  if (value === "aes-256-gcm" || value === undefined) return 1;
  if (value === "chacha20-poly1305") return 2;
  return 0;
}

function keyEnvelopeSuiteCode(
  value: WebTTYKeyEnvelopeSuite | undefined,
): number {
  if (value === "hpke-x25519-hkdf-sha256-aes-256-gcm" || value === undefined) {
    return 1;
  }
  if (value === "hpke-x25519-hkdf-sha256-chacha20-poly1305") return 2;
  return 0;
}

function signatureSuiteCode(value: WebTTYSignatureSuite | undefined): number {
  if (value === "ecdsa-p256-sha256" || value === undefined) return 1;
  return 0;
}

function payloadSuitesBytes(values: WebTTYPayloadCipherSuite[] | undefined) {
  return counted(values?.map(payloadSuiteCode) ?? []);
}

function keyEnvelopeSuitesBytes(values: WebTTYKeyEnvelopeSuite[] | undefined) {
  return counted(values?.map(keyEnvelopeSuiteCode) ?? []);
}

function signatureSuitesBytes(values: WebTTYSignatureSuite[] | undefined) {
  return counted(values?.map(signatureSuiteCode) ?? []);
}

function counted(values: number[]): Uint8Array {
  return concat(be32(values.length), ...values.map(be32));
}

function lengthPrefixedString(value: string | undefined): Uint8Array {
  return lengthPrefixed(utf8(value?.trim() ?? ""));
}

function lengthPrefixed(value: Uint8Array | undefined): Uint8Array {
  const data = value === undefined ? new Uint8Array() : new Uint8Array(value);
  return concat(be32(data.byteLength), data);
}

function be32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

function concat(...chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
  const out = new Uint8Array(length);
  chunks.reduce((offset, chunk) => {
    out.set(chunk, offset);
    return offset + chunk.byteLength;
  }, 0);
  return out;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function sha256(value: Uint8Array): Promise<Uint8Array> {
  if (globalThis.crypto?.subtle === undefined) {
    throw new Error("WebCrypto subtle is not available in this runtime");
  }
  const data = new Uint8Array(value.byteLength);
  data.set(value);
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", data));
}

async function signWebTTYProofTranscript(
  privateKey: CryptoKey | Uint8Array,
  transcriptBytes: Uint8Array,
  transcriptHash: Uint8Array,
): Promise<WebTTYProofSignature> {
  if (transcriptHash.byteLength !== 32) {
    throw new Error("WebTTY proof transcript hash must be 32 bytes");
  }
  const key = isCryptoKey(privateKey)
    ? privateKey
    : await globalThis.crypto.subtle.importKey(
        "pkcs8",
        copyBufferSource(privateKey),
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"],
      );
  const rawSignature = new Uint8Array(
    await globalThis.crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      copyBufferSource(transcriptBytes),
    ),
  );
  return {
    signature: webCryptoECDSARawSignatureToDER(rawSignature),
    transcriptHash,
  };
}

function isCryptoKey(value: CryptoKey | Uint8Array): value is CryptoKey {
  return typeof CryptoKey !== "undefined" && value instanceof CryptoKey;
}

async function verifyWebTTYProofTranscript(
  publicKey: Uint8Array,
  transcriptBytes: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  const key = await globalThis.crypto.subtle.importKey(
    "spki",
    copyBufferSource(publicKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  return globalThis.crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    copyBufferSource(webCryptoECDSADERToRawSignature(signature)),
    copyBufferSource(transcriptBytes),
  );
}

function copyBufferSource(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function webCryptoECDSARawSignatureToDER(signature: Uint8Array): Uint8Array {
  if (signature.byteLength !== 64) {
    throw new Error("WebTTY ECDSA P-256 raw signature must be 64 bytes");
  }
  const r = derInteger(signature.subarray(0, 32));
  const s = derInteger(signature.subarray(32, 64));
  const body = concat(r, s);
  return concat(new Uint8Array([0x30, body.byteLength]), body);
}

function webCryptoECDSADERToRawSignature(signature: Uint8Array): Uint8Array {
  if (signature.byteLength < 8 || signature[0] !== 0x30) {
    throw new Error("WebTTY ECDSA signature is not a DER sequence");
  }
  const sequenceLength = signature[1] ?? 0;
  if (sequenceLength + 2 !== signature.byteLength) {
    throw new Error(
      "WebTTY ECDSA signature has an invalid DER sequence length",
    );
  }
  const r = readDERInteger(signature, 2);
  const s = readDERInteger(signature, r.nextOffset);
  if (s.nextOffset !== signature.byteLength) {
    throw new Error("WebTTY ECDSA signature has trailing DER data");
  }
  return concat(leftPad32(r.value), leftPad32(s.value));
}

function derInteger(value: Uint8Array): Uint8Array {
  const firstNonZeroOffset = value.findIndex((byte) => byte !== 0);
  const offset =
    firstNonZeroOffset === -1
      ? Math.max(0, value.byteLength - 1)
      : firstNonZeroOffset;
  const unsignedInteger = value.subarray(offset);
  const integer =
    ((unsignedInteger[0] ?? 0) & 0x80) !== 0
      ? concat(new Uint8Array([0]), unsignedInteger)
      : unsignedInteger;
  return concat(new Uint8Array([0x02, integer.byteLength]), integer);
}

function readDERInteger(
  signature: Uint8Array,
  offset: number,
): { nextOffset: number; value: Uint8Array } {
  if (offset + 1 >= signature.byteLength || signature[offset] !== 0x02) {
    throw new Error("WebTTY ECDSA signature is missing a DER integer");
  }
  const length = signature[offset + 1] ?? 0;
  const start = offset + 2;
  const end = start + length;
  if (length === 0 || end > signature.byteLength) {
    throw new Error("WebTTY ECDSA signature has an invalid DER integer length");
  }
  const encodedValue = signature.subarray(start, end);
  const value =
    encodedValue.byteLength > 1 && encodedValue[0] === 0
      ? encodedValue.subarray(1)
      : encodedValue;
  if (value.byteLength > 32) {
    throw new Error("WebTTY ECDSA P-256 integer is too large");
  }
  return { nextOffset: end, value };
}

function leftPad32(value: Uint8Array): Uint8Array {
  if (value.byteLength > 32) {
    throw new Error("WebTTY ECDSA P-256 integer is too large");
  }
  const out = new Uint8Array(32);
  out.set(value, 32 - value.byteLength);
  return out;
}

function normalizeConfig(
  config: WebTTYProto.rstream.webtty.protobuf.Config.$Properties,
): WebTTYProto.rstream.webtty.protobuf.Config.$Properties {
  return {
    cmdArgs: config.cmdArgs,
    envVars: config.envVars?.map(normalizeEnvironment),
    options:
      config.options === undefined || config.options === null
        ? undefined
        : normalizeOptions(config.options),
    username:
      config.username === undefined || config.username === null
        ? undefined
        : normalizeUsername(config.username),
    workdir:
      config.workdir === undefined || config.workdir === null
        ? undefined
        : normalizeWorkdir(config.workdir),
  };
}

function normalizeOptions(
  options: WebTTYProto.rstream.webtty.protobuf.Options.$Properties,
): WebTTYProto.rstream.webtty.protobuf.Options.$Properties {
  return {
    allocateTty: options.allocateTty === true ? true : undefined,
    interactive: options.interactive === true ? true : undefined,
    sendHeartbeat: options.sendHeartbeat === true ? true : undefined,
  };
}

function normalizeEnvironment(
  environment: WebTTYProto.rstream.webtty.protobuf.Environment.$Properties,
): WebTTYProto.rstream.webtty.protobuf.Environment.$Properties {
  return {
    key: environment.key === "" ? undefined : environment.key,
    value: environment.value === "" ? undefined : environment.value,
  };
}

function normalizeWorkdir(
  workdir: WebTTYProto.rstream.webtty.protobuf.Workdir.$Properties,
): WebTTYProto.rstream.webtty.protobuf.Workdir.$Properties {
  return {
    value: workdir.value === "" ? undefined : workdir.value,
  };
}

function normalizeUsername(
  username: WebTTYProto.rstream.webtty.protobuf.Username.$Properties,
): WebTTYProto.rstream.webtty.protobuf.Username.$Properties {
  return {
    id: username.id === 0 ? undefined : username.id,
    name: username.name === "" ? undefined : username.name,
  };
}

function normalizeSessionKeyGrant(
  grant: WebTTYProto.rstream.webtty.protobuf.SessionKeyGrant.$Properties,
): WebTTYProto.rstream.webtty.protobuf.SessionKeyGrant.$Properties {
  return {
    keyContext:
      grant.keyContext !== undefined &&
      grant.keyContext !== null &&
      grant.keyContext.byteLength > 0
        ? grant.keyContext
        : undefined,
    keyEnvelopeSuite: grant.keyEnvelopeSuite,
    keyEnvelopes: grant.keyEnvelopes,
    payloadKeyId: grant.payloadKeyId,
    payloadSuite: grant.payloadSuite,
  };
}
