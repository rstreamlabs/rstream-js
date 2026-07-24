// See LICENSE file in the project root for license information.

import type { WebTTYE2EKeyEnvelopeSuite } from "./webtty";
import type { WebTTYE2EPayloadCipherSuite } from "./webtty";
import type { WebTTYEncryptedPayload } from "./webtty";
import type { WebTTYKeyEnvelope } from "./webtty";
import type { WebTTYKeyEnvelopeSuite } from "./webtty";
import type { WebTTYPayloadCipherSuite } from "./webtty";
import type { WebTTYPayloadCrypto } from "./webtty";
import type { WebTTYPayloadCryptoInfo } from "./webtty";
import type { WebTTYPayloadCryptoMetadata } from "./webtty";
import type { WebTTYSessionKeyGrant } from "./webtty";

const x25519PublicKeySize = 32;
const x25519PrivateKeySize = 32;
const payloadKeySize = 32;
const payloadKeyIDSize = 16;
const aesGCMNonceSize = 12;
const hpkeKEMX25519HKDFSHA256 = 0x0020;
const hpkeKDFHKDFSHA256 = 0x0001;
const hpkeAEADAES256GCM = 0x0002;
const hpkeInfoDomain = "rstream-webtty-e2e-key/v1";
const payloadAADDomain = "rstream-webtty-e2e-payload/v1";
const keyIDDomain = "rstream-webtty-e2e-key-id/v1";
const hpkeVersionLabel = "HPKE-v1";
const nominalPayloadSuite: WebTTYE2EPayloadCipherSuite = "aes-256-gcm";
const nominalKeyEnvelopeSuite: WebTTYE2EKeyEnvelopeSuite =
  "hpke-x25519-hkdf-sha256-aes-256-gcm";

export type WebTTYE2EKeyMaterial = Uint8Array | string;
export type WebTTYE2ERecipientKind =
  "public_key" | "user" | "workspace_device" | "workspace_keyset" | "server";

export interface WebTTYE2EIdentity {
  keyId: WebTTYE2EKeyMaterial;
  privateKey: WebTTYE2EKeyMaterial;
  publicKey: WebTTYE2EKeyMaterial;
}

export interface WebTTYE2ERecipient {
  id?: string;
  keyId?: WebTTYE2EKeyMaterial;
  kind?: WebTTYE2ERecipientKind;
  publicKey: WebTTYE2EKeyMaterial;
}

export interface WebTTYE2EKeyContextRecipient {
  id: string;
  keyId: WebTTYE2EKeyMaterial;
  kind: WebTTYE2ERecipientKind;
}

export interface WebTTYE2EKeyContextConfig {
  projectId?: string;
  recipients: WebTTYE2EKeyContextRecipient[];
  serverId?: string;
  workspaceId?: string;
}

export interface WebTTYE2EPayloadCryptoConfig {
  keyContext?: Uint8Array | string;
  keyEnvelopeSuite?: WebTTYE2EKeyEnvelopeSuite;
  payloadKey?: WebTTYE2EKeyMaterial;
  payloadKeyId?: WebTTYE2EKeyMaterial;
  payloadSuite?: WebTTYE2EPayloadCipherSuite;
  recipients: WebTTYE2ERecipient[];
}

export interface WebTTYE2EPayloadCrypto extends WebTTYPayloadCrypto {
  decryptStdin: (payload: WebTTYEncryptedPayload) => Promise<Uint8Array>;
  encryptStderr: (chunk: Uint8Array) => Promise<WebTTYEncryptedPayload>;
  encryptStdout: (chunk: Uint8Array) => Promise<WebTTYEncryptedPayload>;
}

interface HPKESealResult {
  encapsulatedKey: Uint8Array;
  wrappedKey: Uint8Array;
}

interface E2EPayloadCipherOptions {
  keyContext: Uint8Array;
  keyEnvelopes: WebTTYKeyEnvelope[];
  keyEnvelopeSuite: WebTTYE2EKeyEnvelopeSuite;
  payloadKey: Uint8Array;
  payloadKeyId: Uint8Array;
  payloadSuite: WebTTYE2EPayloadCipherSuite;
}

interface WebTTYE2EIdentityBytes {
  keyId: Uint8Array;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export async function generateWebTTYE2EIdentity(): Promise<WebTTYE2EIdentity> {
  const pair = await getSubtle().generateKey({ name: "X25519" }, true, [
    "deriveBits",
  ]);
  if (!isX25519KeyPair(pair)) {
    throw new Error("WebCrypto returned an unexpected X25519 key pair");
  }
  const publicKey = new Uint8Array(
    await getSubtle().exportKey("raw", pair.publicKey),
  );
  const jwk = await getSubtle().exportKey("jwk", pair.privateKey);
  if (typeof jwk.d !== "string") {
    throw new Error("WebCrypto X25519 private JWK is missing d");
  }
  return {
    keyId: await webTTYE2EKeyID(publicKey),
    privateKey: base64URLDecode(jwk.d),
    publicKey,
  };
}

export async function webTTYE2EKeyID(
  publicKey: Uint8Array,
): Promise<Uint8Array> {
  const digest = new Uint8Array(
    await getSubtle().digest(
      "SHA-256",
      bufferSource(concat(utf8(keyIDDomain), cloneBytes(publicKey))),
    ),
  );
  return digest.slice(0, payloadKeyIDSize);
}

export function encodeWebTTYE2EKeyMaterial(
  value: WebTTYE2EKeyMaterial,
): string {
  return base64URLEncode(cloneKeyMaterial(value));
}

export function decodeWebTTYE2EKeyMaterial(value: string): Uint8Array {
  return base64URLDecode(value);
}

export function createWebTTYE2EKeyContext(
  config: WebTTYE2EKeyContextConfig,
): Uint8Array {
  if (config.recipients.length === 0) {
    throw new Error("E2E key context requires at least one recipient");
  }
  return utf8(
    JSON.stringify({
      v: 1,
      type: "rstream.webtty.session_key_grant",
      workspace_id: nonEmptyString(config.workspaceId),
      project_id: nonEmptyString(config.projectId),
      server_id: nonEmptyString(config.serverId),
      recipients: config.recipients.map((recipient) => ({
        key_id: base64URLEncode(normalizeKeyID(recipient.keyId, "recipient")),
        kind: normalizeRecipientKind(recipient.kind),
        id: nonEmptyString(recipient.id, "recipient id"),
      })),
    }),
  );
}

export async function createWebTTYE2EClientPayloadCrypto(
  config: WebTTYE2EPayloadCryptoConfig,
): Promise<WebTTYE2EPayloadCrypto> {
  const payloadSuite = config.payloadSuite ?? nominalPayloadSuite;
  const keyEnvelopeSuite = config.keyEnvelopeSuite ?? nominalKeyEnvelopeSuite;
  validateSuites(payloadSuite, keyEnvelopeSuite);
  const payloadKey = config.payloadKey
    ? cloneKeyMaterial(config.payloadKey)
    : randomBytes(payloadKeySize);
  if (payloadKey.byteLength !== payloadKeySize) {
    throw new Error(`E2E payload key must be ${payloadKeySize} bytes`);
  }
  const payloadKeyId = config.payloadKeyId
    ? cloneKeyMaterial(config.payloadKeyId)
    : randomBytes(payloadKeyIDSize);
  if (payloadKeyId.byteLength !== payloadKeyIDSize) {
    throw new Error(`E2E payload key id must be ${payloadKeyIDSize} bytes`);
  }
  if (config.recipients.length === 0) {
    throw new Error(
      "E2E client payload crypto requires at least one recipient",
    );
  }
  const keyContext =
    config.keyContext !== undefined
      ? cloneKeyContext(config.keyContext)
      : await implicitKeyContextFromRecipients(config.recipients);
  const keyEnvelopes: WebTTYKeyEnvelope[] = [];
  for (const recipient of config.recipients) {
    keyEnvelopes.push(
      await wrapPayloadKey(
        payloadKey,
        payloadSuite,
        payloadKeyId,
        keyContext,
        keyEnvelopeSuite,
        recipient,
      ),
    );
  }
  return createPayloadCrypto({
    keyContext,
    keyEnvelopes,
    keyEnvelopeSuite,
    payloadKey,
    payloadKeyId,
    payloadSuite,
  });
}

export async function createWebTTYE2EServerPayloadCrypto(
  sessionKeyGrant: WebTTYSessionKeyGrant | undefined,
  identity: WebTTYE2EIdentity,
): Promise<WebTTYE2EPayloadCrypto> {
  if (sessionKeyGrant === undefined) {
    throw new Error("missing E2E session key grant");
  }
  const payloadSuite = sessionKeyGrant.payloadSuite;
  const keyEnvelopeSuite = sessionKeyGrant.keyEnvelopeSuite;
  if (payloadSuite === undefined || keyEnvelopeSuite === undefined) {
    throw new Error("E2E session key grant is missing suite metadata");
  }
  const suites = validateSuites(payloadSuite, keyEnvelopeSuite);
  const normalizedIdentity = normalizeIdentity(identity);
  const keyId =
    normalizedIdentity.keyId.byteLength > 0
      ? cloneBytes(normalizedIdentity.keyId)
      : await webTTYE2EKeyID(normalizedIdentity.publicKey);
  if (keyId.byteLength !== payloadKeyIDSize) {
    throw new Error(`E2E identity key id must be ${payloadKeyIDSize} bytes`);
  }
  const envelope = (sessionKeyGrant.keyEnvelopes ?? []).find((candidate) =>
    bytesEqual(candidate.recipientKeyId, keyId),
  );
  if (envelope === undefined) {
    throw new Error(
      "E2E session key grant does not contain a key envelope for this identity",
    );
  }
  const payloadKeyId = cloneBytes(sessionKeyGrant.payloadKeyId);
  if (payloadKeyId.byteLength !== payloadKeyIDSize) {
    throw new Error(`E2E payload key id must be ${payloadKeyIDSize} bytes`);
  }
  const keyContext = cloneBytes(sessionKeyGrant.keyContext);
  const payloadKey = await unwrapPayloadKey(
    envelope,
    suites.payloadSuite,
    payloadKeyId,
    keyContext,
    suites.keyEnvelopeSuite,
    normalizedIdentity,
  );
  return createPayloadCrypto({
    keyContext,
    keyEnvelopes: [],
    keyEnvelopeSuite: suites.keyEnvelopeSuite,
    payloadKey,
    payloadKeyId,
    payloadSuite: suites.payloadSuite,
  });
}

function createPayloadCrypto(
  options: E2EPayloadCipherOptions,
): WebTTYE2EPayloadCrypto {
  const sessionKeyGrant: WebTTYSessionKeyGrant = {
    keyContext: cloneBytes(options.keyContext),
    keyEnvelopeSuite: options.keyEnvelopeSuite,
    keyEnvelopes: cloneKeyEnvelopes(options.keyEnvelopes),
    payloadKeyId: cloneBytes(options.payloadKeyId),
    payloadSuite: options.payloadSuite,
  };
  const cryptoInfo: WebTTYPayloadCryptoInfo = {
    keyAgreement: "HPKE X25519",
    keyDerivation: "HKDF-SHA256",
    keyEncryption: "AES-256-GCM",
    keyEnvelopeSuite: options.keyEnvelopeSuite,
    mode: "end-to-end",
    payloadCipher: "AES-256-GCM",
    payloadKeyId: cloneBytes(options.payloadKeyId),
    payloadNonceBits: 96,
    payloadSuite: options.payloadSuite,
    payloadTagBits: 128,
  };
  const encrypt =
    (stream: string) =>
    async (chunk: Uint8Array): Promise<WebTTYEncryptedPayload> => {
      if (chunk.byteLength > 0xffffffff) {
        throw new Error(`E2E payload is too large: ${chunk.byteLength} bytes`);
      }
      const nonce = randomBytes(aesGCMNonceSize);
      const payloadCrypto: WebTTYPayloadCryptoMetadata = {
        aadContext: cloneBytes(options.keyContext),
        nonce,
        payloadKeyId: cloneBytes(options.payloadKeyId),
        payloadSuite: options.payloadSuite,
      };
      return {
        ciphertext: await aesGCMEncrypt(
          options.payloadKey,
          nonce,
          cloneBytes(chunk),
          payloadAAD(
            stream,
            options.payloadSuite,
            options.payloadKeyId,
            options.keyContext,
            nonce,
            chunk.byteLength,
          ),
        ),
        payloadCrypto,
        plaintextLength: chunk.byteLength,
      };
    };
  const decrypt =
    (stream: string) =>
    async (payload: WebTTYEncryptedPayload): Promise<Uint8Array> => {
      validatePayloadEnvelope(payload, options);
      const crypto = payload.payloadCrypto;
      if (crypto === undefined || crypto.nonce === undefined) {
        throw new Error("missing E2E payload nonce");
      }
      const plaintext = await aesGCMDecrypt(
        options.payloadKey,
        crypto.nonce,
        payload.ciphertext,
        payloadAAD(
          stream,
          options.payloadSuite,
          options.payloadKeyId,
          options.keyContext,
          crypto.nonce,
          payload.plaintextLength,
        ),
      );
      if (plaintext.byteLength !== payload.plaintextLength) {
        throw new Error(
          `E2E ${stream} payload length mismatch: got ${plaintext.byteLength} want ${payload.plaintextLength}`,
        );
      }
      return plaintext;
    };
  return {
    capabilities: ["encrypted-payload", "session-crypto"],
    cryptoInfo,
    decryptStderr: decrypt("stderr"),
    decryptStdin: decrypt("stdin"),
    decryptStdout: decrypt("stdout"),
    encryptStderr: encrypt("stderr"),
    encryptStdin: encrypt("stdin"),
    encryptStdout: encrypt("stdout"),
    sessionKeyGrant,
  };
}

async function implicitKeyContextFromRecipients(
  recipients: WebTTYE2ERecipient[],
): Promise<Uint8Array> {
  const contextRecipients = await Promise.all(
    recipients.map(async (recipient): Promise<WebTTYE2EKeyContextRecipient> => {
      const publicKey = cloneKeyMaterial(recipient.publicKey);
      const keyId = recipient.keyId
        ? cloneKeyMaterial(recipient.keyId)
        : await webTTYE2EKeyID(publicKey);
      const implicitPublicKey =
        recipient.kind === undefined && recipient.id === undefined;
      const kind = implicitPublicKey ? "public_key" : recipient.kind;
      const id = implicitPublicKey
        ? encodeWebTTYE2EKeyMaterial(keyId)
        : recipient.id?.trim();
      if (kind === undefined || id === undefined || id === "") {
        throw new Error("E2E typed recipients require both kind and id");
      }
      return {
        id,
        keyId,
        kind: normalizeRecipientKind(kind),
      };
    }),
  );
  return createWebTTYE2EKeyContext({ recipients: contextRecipients });
}

async function wrapPayloadKey(
  payloadKey: Uint8Array,
  payloadSuite: WebTTYPayloadCipherSuite,
  payloadKeyId: Uint8Array,
  keyContext: Uint8Array,
  suite: WebTTYKeyEnvelopeSuite,
  recipient: WebTTYE2ERecipient,
): Promise<WebTTYKeyEnvelope> {
  const recipientPublicKey = cloneKeyMaterial(recipient.publicKey);
  if (recipientPublicKey.byteLength !== x25519PublicKeySize) {
    throw new Error(
      `E2E recipient public key must be ${x25519PublicKeySize} bytes`,
    );
  }
  const recipientKeyId = recipient.keyId
    ? cloneKeyMaterial(recipient.keyId)
    : await webTTYE2EKeyID(recipientPublicKey);
  if (recipientKeyId.byteLength !== payloadKeyIDSize) {
    throw new Error(`E2E recipient key id must be ${payloadKeyIDSize} bytes`);
  }
  const sealed = await hpkeSeal(
    recipientPublicKey,
    hpkeInfo(payloadSuite, payloadKeyId, keyContext, suite),
    hpkeAAD(recipientKeyId, payloadSuite, payloadKeyId, keyContext, suite),
    payloadKey,
  );
  return {
    encapsulatedKey: sealed.encapsulatedKey,
    recipientKeyId,
    wrappedKey: sealed.wrappedKey,
  };
}

async function unwrapPayloadKey(
  envelope: WebTTYKeyEnvelope,
  payloadSuite: WebTTYPayloadCipherSuite,
  payloadKeyId: Uint8Array,
  keyContext: Uint8Array,
  suite: WebTTYKeyEnvelopeSuite,
  identity: WebTTYE2EIdentityBytes,
): Promise<Uint8Array> {
  if (envelope.encapsulatedKey === undefined) {
    throw new Error("E2E key envelope is missing encapsulated key");
  }
  if (envelope.recipientKeyId === undefined) {
    throw new Error("E2E key envelope is missing recipient key id");
  }
  if (envelope.wrappedKey === undefined) {
    throw new Error("E2E key envelope is missing wrapped key");
  }
  const payloadKey = await hpkeOpen(
    identity,
    envelope.encapsulatedKey,
    hpkeInfo(payloadSuite, payloadKeyId, keyContext, suite),
    hpkeAAD(
      envelope.recipientKeyId,
      payloadSuite,
      payloadKeyId,
      keyContext,
      suite,
    ),
    envelope.wrappedKey,
  );
  if (payloadKey.byteLength !== payloadKeySize) {
    throw new Error(
      `E2E unwrapped payload key must be ${payloadKeySize} bytes`,
    );
  }
  return payloadKey;
}

async function hpkeSeal(
  publicKey: Uint8Array,
  info: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
): Promise<HPKESealResult> {
  const recipientPublic = await getSubtle().importKey(
    "raw",
    bufferSource(cloneBytes(publicKey)),
    { name: "X25519" },
    false,
    [],
  );
  const ephemeral = await getSubtle().generateKey({ name: "X25519" }, true, [
    "deriveBits",
  ]);
  if (!isX25519KeyPair(ephemeral)) {
    throw new Error("WebCrypto returned an unexpected X25519 key pair");
  }
  const encapsulatedKey = new Uint8Array(
    await getSubtle().exportKey("raw", ephemeral.publicKey),
  );
  const dh = new Uint8Array(
    await getSubtle().deriveBits(
      { name: "X25519", public: recipientPublic },
      ephemeral.privateKey,
      256,
    ),
  );
  const sharedSecret = await dhkemExtractAndExpand(
    dh,
    concat(encapsulatedKey, publicKey),
  );
  const schedule = await hpkeKeySchedule(sharedSecret, info);
  return {
    encapsulatedKey,
    wrappedKey: await aesGCMEncrypt(
      schedule.key,
      schedule.baseNonce,
      plaintext,
      aad,
    ),
  };
}

async function hpkeOpen(
  identity: WebTTYE2EIdentityBytes,
  encapsulatedKey: Uint8Array,
  info: Uint8Array,
  aad: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  if (identity.privateKey.byteLength !== x25519PrivateKeySize) {
    throw new Error(
      `E2E identity private key must be ${x25519PrivateKeySize} bytes`,
    );
  }
  if (identity.publicKey.byteLength !== x25519PublicKeySize) {
    throw new Error(
      `E2E identity public key must be ${x25519PublicKeySize} bytes`,
    );
  }
  const recipientPrivate = await importX25519PrivateKey(identity);
  const ephemeralPublic = await getSubtle().importKey(
    "raw",
    bufferSource(cloneBytes(encapsulatedKey)),
    { name: "X25519" },
    false,
    [],
  );
  const dh = new Uint8Array(
    await getSubtle().deriveBits(
      { name: "X25519", public: ephemeralPublic },
      recipientPrivate,
      256,
    ),
  );
  const sharedSecret = await dhkemExtractAndExpand(
    dh,
    concat(encapsulatedKey, identity.publicKey),
  );
  const schedule = await hpkeKeySchedule(sharedSecret, info);
  return aesGCMDecrypt(schedule.key, schedule.baseNonce, ciphertext, aad);
}

async function dhkemExtractAndExpand(
  dh: Uint8Array,
  kemContext: Uint8Array,
): Promise<Uint8Array> {
  const eaePRK = await labeledExtract(
    dhkemSuiteID(),
    new Uint8Array(),
    "eae_prk",
    dh,
  );
  return labeledExpand(dhkemSuiteID(), eaePRK, "shared_secret", kemContext, 32);
}

async function hpkeKeySchedule(
  sharedSecret: Uint8Array,
  info: Uint8Array,
): Promise<{ baseNonce: Uint8Array; key: Uint8Array }> {
  const suiteID = hpkeSuiteID();
  const pskIDHash = await labeledExtract(
    suiteID,
    new Uint8Array(),
    "psk_id_hash",
    new Uint8Array(),
  );
  const infoHash = await labeledExtract(
    suiteID,
    new Uint8Array(),
    "info_hash",
    info,
  );
  const keyScheduleContext = concat(new Uint8Array([0]), pskIDHash, infoHash);
  const secret = await labeledExtract(
    suiteID,
    sharedSecret,
    "secret",
    new Uint8Array(),
  );
  return {
    baseNonce: await labeledExpand(
      suiteID,
      secret,
      "base_nonce",
      keyScheduleContext,
      aesGCMNonceSize,
    ),
    key: await labeledExpand(
      suiteID,
      secret,
      "key",
      keyScheduleContext,
      payloadKeySize,
    ),
  };
}

async function labeledExtract(
  suiteID: Uint8Array,
  salt: Uint8Array,
  label: string,
  ikm: Uint8Array,
): Promise<Uint8Array> {
  return hkdfExtract(
    salt,
    concat(utf8(hpkeVersionLabel), suiteID, utf8(label), ikm),
  );
}

async function labeledExpand(
  suiteID: Uint8Array,
  prk: Uint8Array,
  label: string,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  return hkdfExpand(
    prk,
    concat(be16(length), utf8(hpkeVersionLabel), suiteID, utf8(label), info),
    length,
  );
}

async function hkdfExtract(
  salt: Uint8Array,
  ikm: Uint8Array,
): Promise<Uint8Array> {
  const hmacKey = await getSubtle().importKey(
    "raw",
    bufferSource(salt.byteLength === 0 ? new Uint8Array(32) : salt),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await getSubtle().sign("HMAC", hmacKey, bufferSource(ikm)),
  );
}

async function hkdfExpand(
  prk: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const hmacKey = await getSubtle().importKey(
    "raw",
    bufferSource(prk),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const blocks = await hkdfExpandBlocks({
    blocks: [],
    counter: 1,
    hmacKey,
    info,
    length,
    previous: new Uint8Array(),
    produced: 0,
  });
  return concat(...blocks).slice(0, length);
}

async function hkdfExpandBlocks(params: {
  blocks: readonly Uint8Array[];
  counter: number;
  hmacKey: CryptoKey;
  info: Uint8Array;
  length: number;
  previous: Uint8Array;
  produced: number;
}): Promise<Uint8Array[]> {
  if (params.produced >= params.length) return [...params.blocks];
  const previous = new Uint8Array(
    await getSubtle().sign(
      "HMAC",
      params.hmacKey,
      bufferSource(
        concat(params.previous, params.info, new Uint8Array([params.counter])),
      ),
    ),
  );
  return await hkdfExpandBlocks({
    ...params,
    blocks: [...params.blocks, previous],
    counter: params.counter + 1,
    previous,
    produced: params.produced + previous.byteLength,
  });
}

async function aesGCMEncrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await getSubtle().importKey(
    "raw",
    bufferSource(key),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  return new Uint8Array(
    await getSubtle().encrypt(
      {
        additionalData: bufferSource(aad),
        iv: bufferSource(nonce),
        name: "AES-GCM",
        tagLength: 128,
      },
      cryptoKey,
      bufferSource(plaintext),
    ),
  );
}

async function aesGCMDecrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await getSubtle().importKey(
    "raw",
    bufferSource(key),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  return new Uint8Array(
    await getSubtle().decrypt(
      {
        additionalData: bufferSource(aad),
        iv: bufferSource(nonce),
        name: "AES-GCM",
        tagLength: 128,
      },
      cryptoKey,
      bufferSource(ciphertext),
    ),
  );
}

async function importX25519PrivateKey(
  identity: WebTTYE2EIdentityBytes,
): Promise<CryptoKey> {
  return getSubtle().importKey(
    "jwk",
    {
      crv: "X25519",
      d: base64URLEncode(identity.privateKey),
      ext: true,
      key_ops: ["deriveBits"],
      kty: "OKP",
      x: base64URLEncode(identity.publicKey),
    },
    { name: "X25519" },
    false,
    ["deriveBits"],
  );
}

function validatePayloadEnvelope(
  payload: WebTTYEncryptedPayload,
  options: E2EPayloadCipherOptions,
): void {
  const crypto = payload.payloadCrypto;
  if (crypto === undefined) throw new Error("missing E2E payload crypto");
  if (crypto.payloadSuite !== options.payloadSuite) {
    throw new Error(`unexpected E2E payload suite ${crypto.payloadSuite}`);
  }
  if (!bytesEqual(crypto.payloadKeyId, options.payloadKeyId)) {
    throw new Error("unexpected E2E payload key id");
  }
  if (!bytesEqual(crypto.aadContext, options.keyContext)) {
    throw new Error("unexpected E2E key context");
  }
  if (
    crypto.nonce === undefined ||
    crypto.nonce.byteLength !== aesGCMNonceSize
  ) {
    throw new Error(`E2E AES-GCM nonce must be ${aesGCMNonceSize} bytes`);
  }
}

function validateSuites(
  payloadSuite: WebTTYPayloadCipherSuite,
  keyEnvelopeSuite: WebTTYKeyEnvelopeSuite,
): {
  keyEnvelopeSuite: WebTTYE2EKeyEnvelopeSuite;
  payloadSuite: WebTTYE2EPayloadCipherSuite;
} {
  if (payloadSuite !== nominalPayloadSuite) {
    throw new Error(`unsupported E2E payload suite ${payloadSuite}`);
  }
  if (keyEnvelopeSuite !== nominalKeyEnvelopeSuite) {
    throw new Error(`unsupported E2E key envelope suite ${keyEnvelopeSuite}`);
  }
  return { keyEnvelopeSuite, payloadSuite };
}

function hpkeInfo(
  payloadSuite: WebTTYPayloadCipherSuite,
  payloadKeyId: Uint8Array,
  keyContext: Uint8Array,
  suite: WebTTYKeyEnvelopeSuite,
): Uint8Array {
  return concat(
    lengthPrefixed(utf8(hpkeInfoDomain)),
    be32(payloadSuiteCode(payloadSuite)),
    be32(keyEnvelopeSuiteCode(suite)),
    lengthPrefixed(payloadKeyId),
    lengthPrefixed(keyContext),
  );
}

function hpkeAAD(
  recipientKeyId: Uint8Array,
  payloadSuite: WebTTYPayloadCipherSuite,
  payloadKeyId: Uint8Array,
  keyContext: Uint8Array,
  suite: WebTTYKeyEnvelopeSuite,
): Uint8Array {
  return concat(
    lengthPrefixed(utf8("key-wrap")),
    be32(payloadSuiteCode(payloadSuite)),
    be32(keyEnvelopeSuiteCode(suite)),
    lengthPrefixed(recipientKeyId),
    lengthPrefixed(payloadKeyId),
    lengthPrefixed(keyContext),
  );
}

function payloadAAD(
  stream: string,
  suite: WebTTYPayloadCipherSuite,
  payloadKeyId: Uint8Array,
  keyContext: Uint8Array,
  nonce: Uint8Array,
  plaintextLength: number,
): Uint8Array {
  return concat(
    lengthPrefixed(utf8(payloadAADDomain)),
    lengthPrefixed(utf8(stream)),
    be32(payloadSuiteCode(suite)),
    lengthPrefixed(payloadKeyId),
    lengthPrefixed(keyContext),
    lengthPrefixed(nonce),
    be32(plaintextLength),
  );
}

function payloadSuiteCode(suite: WebTTYPayloadCipherSuite): number {
  if (suite === "aes-256-gcm") return 1;
  if (suite === "chacha20-poly1305") return 2;
  return unsupportedPayloadSuite(suite);
}

function keyEnvelopeSuiteCode(suite: WebTTYKeyEnvelopeSuite): number {
  if (suite === "hpke-x25519-hkdf-sha256-aes-256-gcm") return 1;
  if (suite === "hpke-x25519-hkdf-sha256-chacha20-poly1305") return 2;
  return unsupportedKeyEnvelopeSuite(suite);
}

function unsupportedPayloadSuite(suite: never): never {
  throw new Error(`unsupported payload suite ${String(suite)}`);
}

function unsupportedKeyEnvelopeSuite(suite: never): never {
  throw new Error(`unsupported key envelope suite ${String(suite)}`);
}

function dhkemSuiteID(): Uint8Array {
  return concat(utf8("KEM"), be16(hpkeKEMX25519HKDFSHA256));
}

function hpkeSuiteID(): Uint8Array {
  return concat(
    utf8("HPKE"),
    be16(hpkeKEMX25519HKDFSHA256),
    be16(hpkeKDFHKDFSHA256),
    be16(hpkeAEADAES256GCM),
  );
}

function lengthPrefixed(value: Uint8Array): Uint8Array {
  return concat(be32(value.byteLength), value);
}

function be16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, false);
  return out;
}

function be32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

function cloneBytes(value: Uint8Array | undefined): Uint8Array {
  return value === undefined ? new Uint8Array() : new Uint8Array(value);
}

function cloneKeyMaterial(value: WebTTYE2EKeyMaterial | undefined): Uint8Array {
  if (value === undefined) return new Uint8Array();
  if (typeof value === "string") return base64URLDecode(value);
  return cloneBytes(value);
}

function cloneKeyContext(value: Uint8Array | string | undefined): Uint8Array {
  if (value === undefined) return new Uint8Array();
  return typeof value === "string" ? utf8(value) : cloneBytes(value);
}

function normalizeKeyID(
  value: WebTTYE2EKeyMaterial | undefined,
  label: string,
): Uint8Array {
  const keyID = cloneKeyMaterial(value);
  if (keyID.byteLength !== payloadKeyIDSize) {
    throw new Error(`E2E ${label} key id must be ${payloadKeyIDSize} bytes`);
  }
  return keyID;
}

function normalizeRecipientKind(
  kind: WebTTYE2ERecipientKind,
): WebTTYE2ERecipientKind {
  switch (kind) {
    case "public_key":
    case "user":
    case "workspace_device":
    case "workspace_keyset":
    case "server":
      return kind;
    default:
      return unsupportedRecipientKind(kind);
  }
}

function unsupportedRecipientKind(kind: never): never {
  throw new Error(`unsupported E2E recipient kind ${String(kind)}`);
}

function nonEmptyString(value: string | undefined, label?: string) {
  const trimmed = value?.trim();
  if (trimmed) return trimmed;
  if (label !== undefined) {
    throw new Error(`E2E ${label} must be a non-empty string`);
  }
  return undefined;
}

function normalizeIdentity(
  identity: WebTTYE2EIdentity,
): WebTTYE2EIdentityBytes {
  return {
    keyId: cloneKeyMaterial(identity.keyId),
    privateKey: cloneKeyMaterial(identity.privateKey),
    publicKey: cloneKeyMaterial(identity.publicKey),
  };
}

function bufferSource(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(value.byteLength);
  out.set(value);
  return out;
}

function cloneKeyEnvelopes(
  envelopes: WebTTYKeyEnvelope[],
): WebTTYKeyEnvelope[] {
  return envelopes.map((envelope) => ({
    encapsulatedKey: cloneBytes(envelope.encapsulatedKey),
    recipientKeyId: cloneBytes(envelope.recipientKeyId),
    wrappedKey: cloneBytes(envelope.wrappedKey),
  }));
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

function bytesEqual(
  left: Uint8Array | undefined,
  right: Uint8Array | undefined,
): boolean {
  if (left === undefined || right === undefined) return false;
  if (left.byteLength !== right.byteLength) return false;
  const diff = left.reduce(
    (current, value, index) => current | (value ^ (right[index] ?? 0)),
    0,
  );
  return diff === 0;
}

function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  getCrypto().getRandomValues(out);
  return out;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function getCrypto(): Crypto {
  if (globalThis.crypto === undefined) {
    throw new Error("WebCrypto is not available in this runtime");
  }
  return globalThis.crypto;
}

function getSubtle(): SubtleCrypto {
  const subtle = getCrypto().subtle;
  if (subtle === undefined) {
    throw new Error("WebCrypto subtle is not available in this runtime");
  }
  return subtle;
}

function isX25519KeyPair(
  value: CryptoKeyPair | CryptoKey,
): value is CryptoKeyPair {
  return "privateKey" in value && "publicKey" in value;
}

function base64URLEncode(value: Uint8Array): string {
  const binary = String.fromCharCode(...value);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function base64URLDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("invalid E2E key material");
  }
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const out = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (base64URLEncode(out) !== value) {
    throw new Error("invalid E2E key material");
  }
  return out;
}
