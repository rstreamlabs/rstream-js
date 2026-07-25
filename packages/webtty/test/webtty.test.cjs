// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const protobuf = require("protobufjs");
const test = require("node:test");
const webtty = require("../dist/index.js");
const webttyNode = require("../dist/node.js");

const createWebTTYE2EClientPayloadCrypto =
  webtty.createWebTTYE2EClientPayloadCrypto;
const createWebTTYE2EClientPayloadCryptoFromLocalTrust =
  webttyNode.createWebTTYE2EClientPayloadCryptoFromLocalTrust;
const createWebTTYE2EKeyContext = webtty.createWebTTYE2EKeyContext;
const createWebTTYE2EReplayPayloadCryptoFromKeyGrant =
  webtty.createWebTTYE2EReplayPayloadCryptoFromKeyGrant;
const createWebTTYE2EServerPayloadCrypto =
  webtty.createWebTTYE2EServerPayloadCrypto;
const decodeWebTTYE2EKeyMaterial = webtty.decodeWebTTYE2EKeyMaterial;
const decryptWebTTYRecordedEvent = webtty.decryptWebTTYRecordedEvent;
const decryptWebTTYRecordedTextLog = webtty.decryptWebTTYRecordedTextLog;
const encodeWebTTYE2EKeyMaterial = webtty.encodeWebTTYE2EKeyMaterial;
const executeWebTTYCommand = webtty.executeWebTTYCommand;
const generateWebTTYE2EIdentity = webtty.generateWebTTYE2EIdentity;
const generateWebTTYSigningIdentity = webtty.generateWebTTYSigningIdentity;
const hashWebTTYAttachGrant = webtty.hashWebTTYAttachGrant;
const hashWebTTYClientCredential = webtty.hashWebTTYClientCredential;
const hashWebTTYClientProofTranscript =
  webtty.hashWebTTYClientProofTranscript;
const hashWebTTYConfig = webtty.hashWebTTYConfig;
const hashWebTTYServerProofTranscript =
  webtty.hashWebTTYServerProofTranscript;
const hashWebTTYSessionKeyGrant = webtty.hashWebTTYSessionKeyGrant;
const loadWebTTYKnownServerKeysFile =
  webttyNode.loadWebTTYKnownServerKeysFile;
const openWebTTYCommand = webtty.openWebTTYCommand;
const parseWebDAVMultiStatus = webtty.parseWebDAVMultiStatus;
const parseWebTTYKnownServerKey = webttyNode.parseWebTTYKnownServerKey;
const renderWebTTYRecordedTextLog = webtty.renderWebTTYRecordedTextLog;
const resolveWebTTYExecutionURL = webtty.resolveWebTTYExecutionURL;
const resolveWebTTYFileSystemURL = webtty.resolveWebTTYFileSystemURL;
const runWebTTYCommand = webtty.runWebTTYCommand;
const signWebTTYClientProofTranscript =
  webtty.signWebTTYClientProofTranscript;
const verifyWebTTYClientProofTranscript =
  webtty.verifyWebTTYClientProofTranscript;
const verifyWebTTYServerProofTranscript =
  webtty.verifyWebTTYServerProofTranscript;
const WebTTY = webtty.WebTTY;
const webTTYClientProofTranscriptBytes =
  webtty.webTTYClientProofTranscriptBytes;
const WebTTYFileSystem = webtty.WebTTYFileSystem;
const webTTYRecordedEventEncryptedPayload =
  webtty.webTTYRecordedEventEncryptedPayload;
const WebTTYRemoteExecutor = webtty.WebTTYRemoteExecutor;
const webTTYServerProofTranscriptBytes =
  webtty.webTTYServerProofTranscriptBytes;

const root = protobuf.loadSync(
  path.join(__dirname, "../protobuf/webtty.proto"),
);
const Message = root.lookupType("rstream.webtty.protobuf.Message");

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.binaryType = "";
    this.closeCalls = 0;
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
    this.listeners = new Map();
    this.sent = [];
    this.sentWaiters = new Map();
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type, callback) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }
  removeEventListener(type, callback) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => entry !== callback),
    );
  }
  send(payload) {
    const frame = Buffer.from(payload);
    const index = this.sent.push(frame) - 1;
    this.sentWaiters.get(index)?.(frame);
    this.sentWaiters.delete(index);
  }
  close() {
    this.closeCalls += 1;
    this.resolveClosed();
  }
  dispatch(type, event = {}) {
    for (const callback of this.listeners.get(type) ?? []) {
      callback(event);
    }
  }
  async waitForClose() {
    await withTimeout(this.closed, "WebSocket was not closed.");
  }
  async waitForSent(index) {
    if (this.sent[index]) return this.sent[index];
    return withTimeout(
      new Promise((resolve) => this.sentWaiters.set(index, resolve)),
      "WebSocket frame was not written.",
    );
  }
}

class FakeWebTransportStream {
  constructor() {
    this.sent = [];
    this.sentWaiters = new Map();
    this.readable = new ReadableStream({
      start: (controller) => {
        this.controller = controller;
      },
    });
    this.writable = new WritableStream({
      write: (chunk) => {
        const frame = Buffer.from(chunk);
        const index = this.sent.push(frame) - 1;
        this.sentWaiters.get(index)?.(frame);
        this.sentWaiters.delete(index);
      },
    });
  }
  dispatch(payload) {
    const frame = Buffer.alloc(4 + payload.byteLength);
    frame.writeUInt32BE(payload.byteLength, 0);
    Buffer.from(payload).copy(frame, 4);
    this.controller.enqueue(new Uint8Array(frame));
  }
  async waitForSent(index) {
    if (this.sent[index]) return this.sent[index];
    return withTimeout(
      new Promise((resolve) => this.sentWaiters.set(index, resolve)),
      "WebTransport frame was not written.",
    );
  }
}

class FakeWebTransport {
  static instances = [];
  constructor(url, options) {
    this.closeCalls = 0;
    this.options = options;
    this.ready = Promise.resolve();
    this.stream = new FakeWebTransportStream();
    this.url = url;
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
    FakeWebTransport.instances.push(this);
  }
  async createBidirectionalStream() {
    return this.stream;
  }
  close() {
    this.closeCalls += 1;
    this.resolveClosed();
  }
}

function encode(payload) {
  return Message.encode(Message.create(payload)).finish();
}

function decode(payload) {
  return Message.decode(payload);
}

function decodeFrame(payload) {
  const frame = Buffer.from(payload);
  const size = frame.readUInt32BE(0);
  assert.equal(size, frame.byteLength - 4);
  return decode(frame.subarray(4));
}

function withFakeWebSocket(callback) {
  const original = global.WebSocket;
  FakeWebSocket.instances = [];
  global.WebSocket = FakeWebSocket;
  try {
    callback();
  } finally {
    global.WebSocket = original;
  }
}

async function withAsyncFakeWebSocket(callback) {
  const original = global.WebSocket;
  FakeWebSocket.instances = [];
  global.WebSocket = FakeWebSocket;
  try {
    await callback();
  } finally {
    global.WebSocket = original;
  }
}

async function withAsyncFakeWebTransport(callback) {
  const original = global.WebTransport;
  FakeWebTransport.instances = [];
  global.WebTransport = FakeWebTransport;
  try {
    await callback();
  } finally {
    global.WebTransport = original;
  }
}

function acknowledge(ws) {
  ws.dispatch("open");
  ws.dispatch("message", { data: encode({ ack: {} }) });
  return ws;
}

async function firstFakeWebSocket(attempts = 10) {
  if (FakeWebSocket.instances[0]) return FakeWebSocket.instances[0];
  if (attempts === 0) throw new Error("WebSocket was not created.");
  await Promise.resolve();
  return firstFakeWebSocket(attempts - 1);
}

async function fakeWebSocketSent(ws, index) {
  return ws.waitForSent(index);
}

async function firstFakeWebTransport(attempts = 10) {
  if (FakeWebTransport.instances[0]) return FakeWebTransport.instances[0];
  if (attempts === 0) throw new Error("WebTransport was not created.");
  await Promise.resolve();
  return firstFakeWebTransport(attempts - 1);
}

async function webTransportFrame(stream, index) {
  return stream.waitForSent(index);
}

function connect(client) {
  client.connect();
  return acknowledge(FakeWebSocket.instances[0]);
}

async function flushAsyncHandlers() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function withTimeout(promise, message, timeout = 5000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function collectAsync(iterator, entries = []) {
  const result = await iterator.next();
  return result.done
    ? entries
    : collectAsync(iterator, [...entries, result.value]);
}

async function readStreamText(stream) {
  const reader = stream.getReader();
  const chunks = await readStreamChunks(reader);
  reader.releaseLock();
  return Buffer.concat(chunks).toString();
}

async function readStreamChunks(reader, chunks = []) {
  const result = await reader.read();
  return result.done
    ? chunks
    : readStreamChunks(reader, [...chunks, result.value]);
}

function textStream(value) {
  return new ReadableStream({
    start: (controller) => {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}

function b64(value) {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

test("WebTTY protobuf runtime exposes Reader.tag", () => {
  const minimal = require("protobufjs/minimal.js");
  assert.equal(typeof minimal.Reader.prototype.tag, "function");
});

test("WebTTY auth proof transcript hashes match Go vectors", async () => {
  const encoder = new TextEncoder();
  const commandConfigHash = await hashWebTTYConfig({
    cmdArgs: ["sh", "-lc", "whoami"],
    options: {
      allocateTty: false,
      interactive: false,
      sendHeartbeat: true,
    },
  });
  const sessionKeyGrantHash = await hashWebTTYSessionKeyGrant({
    keyEnvelopeSuite: 1,
    payloadKeyId: encoder.encode("payload-key-id"),
    payloadSuite: 1,
  });
  const serverHash = await hashWebTTYServerProofTranscript({
    authRequirement: "client-proof",
    keyEnvelopeSuites: ["hpke-x25519-hkdf-sha256-aes-256-gcm"],
    payloadSuites: ["aes-256-gcm"],
    projectId: "project-1",
    protocolVersion: "webtty-1",
    serverEncryptionKeyId: encoder.encode("server-encryption-key-id"),
    serverId: "server-1",
    serverNonce: encoder.encode("nonce-1"),
    serverSigningKeyId: encoder.encode("server-signing-key-id"),
    sessionId: "session-1",
    signatureSuites: ["ecdsa-p256-sha256"],
    transport: "websocket",
    workspaceId: "workspace-1",
  });
  const clientHash = await hashWebTTYClientProofTranscript({
    authRequirement: "client-proof",
    clientPrincipalId: "user-1",
    clientSigningKeyId: encoder.encode("client-signing-key-id"),
    commandConfigHash,
    expiresAt: "2026-06-12T10:01:00Z",
    issuedAt: "2026-06-12T10:00:00Z",
    keyEnvelopeSuite: "hpke-x25519-hkdf-sha256-aes-256-gcm",
    payloadSuite: "aes-256-gcm",
    projectId: "project-1",
    protocolVersion: "webtty-1",
    serverEncryptionKeyId: encoder.encode("server-encryption-key-id"),
    serverId: "server-1",
    serverNonce: encoder.encode("nonce-1"),
    serverSigningKeyId: encoder.encode("server-signing-key-id"),
    sessionId: "session-1",
    sessionKeyGrantHash,
    transport: "websocket",
    workspaceId: "workspace-1",
  });
  assert.equal(b64url(serverHash), "uDy-1Y7s7aOa1dCrk9dQ0c3bA6mZWyO7_qZycuOPgT0");
  assert.equal(b64url(clientHash), "KENVbyGFj-d6U1ePniz0ZngXjadyEZJ0IWK2IOODG8Y");
});

test("WebTTY client proof transcript hashes bind trusted device credentials", async () => {
  const encoder = new TextEncoder();
  const clientHash = await hashWebTTYClientProofTranscript({
    authRequirement: "client-proof",
    clientCredentialHash: encoder
      .encode("client-credential-hash-32-bytes!")
      .slice(0, 32),
    clientPrincipalId: "client-1",
    clientSigningKeyId: encoder.encode("client-signing-key-id"),
    commandConfigHash: encoder
      .encode("command-config-hash-32-bytes")
      .slice(0, 32),
    expiresAt: "2026-06-21T10:05:00Z",
    issuedAt: "2026-06-21T10:00:00Z",
    keyEnvelopeSuite: "hpke-x25519-hkdf-sha256-aes-256-gcm",
    payloadSuite: "aes-256-gcm",
    projectId: "project-1",
    protocolVersion: "webtty-1",
    serverEncryptionKeyId: encoder.encode("server-encryption-key-id"),
    serverId: "server-1",
    serverNonce: encoder.encode("server-nonce"),
    serverSigningKeyId: encoder.encode("server-signing-key-id"),
    sessionId: "session-1",
    sessionKeyGrantHash: encoder
      .encode("session-key-grant-hash-32-bytes")
      .slice(0, 32),
    transport: "websocket",
    workspaceId: "workspace-1",
  });
  assert.equal(b64url(clientHash), "qdSkULN-2y4xM7pwCKgBv4egOe600vpSOd-JxGpzFeA");
});

test("WebTTY auth proof transcript hashes are bound to endpoint identity", async () => {
  const encoder = new TextEncoder();
  const base = {
    authRequirement: "client-proof",
    keyEnvelopeSuites: ["hpke-x25519-hkdf-sha256-aes-256-gcm"],
    payloadSuites: ["aes-256-gcm"],
    projectId: "project-1",
    protocolVersion: "webtty-1",
    serverEncryptionKeyId: encoder.encode("server-encryption-key-id"),
    serverId: "server-1",
    serverNonce: encoder.encode("nonce-1"),
    serverSigningKeyId: encoder.encode("server-signing-key-id"),
    sessionId: "session-1",
    signatureSuites: ["ecdsa-p256-sha256"],
    transport: "websocket",
    workspaceId: "workspace-1",
  };
  const original = await hashWebTTYServerProofTranscript(base);
  const changed = await hashWebTTYServerProofTranscript({
    ...base,
    serverId: "server-2",
  });
  assert.notEqual(b64url(original), b64url(changed));
});

test("WebTTY auth proof signs and verifies client transcripts", async () => {
  const encoder = new TextEncoder();
  const identity = await generateWebTTYSigningIdentity();
  const transcript = {
    authRequirement: "client-proof",
    clientPrincipalId: "user-1",
    clientSigningKeyId: identity.keyId,
    commandConfigHash: encoder.encode("command-config-hash"),
    expiresAt: "2026-06-12T10:01:00Z",
    issuedAt: "2026-06-12T10:00:00Z",
    keyEnvelopeSuite: "hpke-x25519-hkdf-sha256-aes-256-gcm",
    payloadSuite: "aes-256-gcm",
    projectId: "project-1",
    protocolVersion: "webtty-1",
    serverEncryptionKeyId: encoder.encode("server-encryption-key-id"),
    serverId: "server-1",
    serverNonce: encoder.encode("nonce-1"),
    serverSigningKeyId: encoder.encode("server-signing-key-id"),
    sessionId: "session-1",
    sessionKeyGrantHash: encoder.encode("session-key-grant-hash"),
    transport: "websocket",
    workspaceId: "workspace-1",
  };
  const proof = await signWebTTYClientProofTranscript(
    identity.privateKey,
    transcript,
  );
  assert.equal(proof.transcriptHash.byteLength, 32);
  assert.equal(
    await verifyWebTTYClientProofTranscript(
      identity.publicKey,
      transcript,
      proof.signature,
    ),
    true,
  );
  assert.equal(
    await verifyWebTTYClientProofTranscript(
      identity.publicKey,
      { ...transcript, clientPrincipalId: "other" },
      proof.signature,
    ),
    false,
  );
});

test("WebTTY client proof verification is bound to every security target field", async () => {
  const encoder = new TextEncoder();
  const identity = await generateWebTTYSigningIdentity();
  const clientCredential = encoder.encode("workspace-device-credential");
  const transcript = {
    authRequirement: "client-proof",
    clientCredentialHash: await hashWebTTYClientCredential(clientCredential),
    clientPrincipalId: "user-1",
    clientSigningKeyId: identity.keyId,
    commandConfigHash: encoder.encode("command-config-hash"),
    expiresAt: "2026-06-12T10:01:00Z",
    issuedAt: "2026-06-12T10:00:00Z",
    keyEnvelopeSuite: "hpke-x25519-hkdf-sha256-aes-256-gcm",
    payloadSuite: "aes-256-gcm",
    projectId: "project-1",
    protocolVersion: "webtty-1",
    serverEncryptionKeyId: encoder.encode("server-encryption-key-id"),
    serverId: "server-1",
    serverNonce: encoder.encode("nonce-1"),
    serverSigningKeyId: encoder.encode("server-signing-key-id"),
    sessionId: "session-1",
    sessionKeyGrantHash: encoder.encode("session-key-grant-hash"),
    transport: "websocket",
    workspaceId: "workspace-1",
  };
  const proof = await signWebTTYClientProofTranscript(
    identity.privateKey,
    transcript,
  );
  const mutations = [
    ["authRequirement", { ...transcript, authRequirement: "none" }],
    [
      "clientCredentialHash",
      {
        ...transcript,
        clientCredentialHash: await hashWebTTYClientCredential(
          encoder.encode("other-credential"),
        ),
      },
    ],
    ["clientPrincipalId", { ...transcript, clientPrincipalId: "user-2" }],
    [
      "clientSigningKeyId",
      {
        ...transcript,
        clientSigningKeyId: encoder.encode("other-client-signing-key-id"),
      },
    ],
    [
      "commandConfigHash",
      { ...transcript, commandConfigHash: encoder.encode("other-command") },
    ],
    ["expiresAt", { ...transcript, expiresAt: "2026-06-12T10:02:00Z" }],
    ["issuedAt", { ...transcript, issuedAt: "2026-06-12T10:00:01Z" }],
    ["projectId", { ...transcript, projectId: "project-2" }],
    [
      "serverEncryptionKeyId",
      {
        ...transcript,
        serverEncryptionKeyId: encoder.encode("other-server-encryption-key"),
      },
    ],
    ["serverId", { ...transcript, serverId: "server-2" }],
    ["serverNonce", { ...transcript, serverNonce: encoder.encode("nonce-2") }],
    [
      "serverSigningKeyId",
      {
        ...transcript,
        serverSigningKeyId: encoder.encode("other-server-signing-key"),
      },
    ],
    ["sessionId", { ...transcript, sessionId: "session-2" }],
    [
      "sessionKeyGrantHash",
      {
        ...transcript,
        sessionKeyGrantHash: encoder.encode("other-session-key-grant"),
      },
    ],
    ["transport", { ...transcript, transport: "webtransport" }],
    ["workspaceId", { ...transcript, workspaceId: "workspace-2" }],
  ];
  for (const [field, mutated] of mutations) {
    assert.equal(
      await verifyWebTTYClientProofTranscript(
        identity.publicKey,
        mutated,
        proof.signature,
      ),
      false,
      `client proof accepted mutated ${field}`,
    );
  }
});

test("WebTTY auth proof signs with a non-extractable CryptoKey", async () => {
  const encoder = new TextEncoder();
  const keyPair = await crypto.webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const publicKey = new Uint8Array(
    await crypto.webcrypto.subtle.exportKey("spki", keyPair.publicKey),
  );
  const transcript = {
    authRequirement: "client-proof",
    clientPrincipalId: "user-1",
    clientSigningKeyId: encoder.encode("client-signing-key-id"),
    commandConfigHash: encoder.encode("command-config-hash"),
    expiresAt: "2026-06-12T10:01:00Z",
    issuedAt: "2026-06-12T10:00:00Z",
    keyEnvelopeSuite: "hpke-x25519-hkdf-sha256-aes-256-gcm",
    payloadSuite: "aes-256-gcm",
    projectId: "project-1",
    protocolVersion: "webtty-1",
    serverEncryptionKeyId: encoder.encode("server-encryption-key-id"),
    serverId: "server-1",
    serverNonce: encoder.encode("nonce-1"),
    serverSigningKeyId: encoder.encode("server-signing-key-id"),
    sessionId: "session-1",
    sessionKeyGrantHash: encoder.encode("session-key-grant-hash"),
    transport: "websocket",
    workspaceId: "workspace-1",
  };
  const proof = await signWebTTYClientProofTranscript(
    keyPair.privateKey,
    transcript,
  );
  assert.equal(proof.transcriptHash.byteLength, 32);
  assert.equal(
    await verifyWebTTYClientProofTranscript(
      publicKey,
      transcript,
      proof.signature,
    ),
    true,
  );
});

test("WebTTY auth proof verifies DER signatures over canonical transcripts", async () => {
  const encoder = new TextEncoder();
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const publicKeyDER = publicKey.export({ format: "der", type: "spki" });
  const transcript = {
    authRequirement: "client-proof",
    clientPrincipalId: "user-1",
    clientSigningKeyId: encoder.encode("client-signing-key-id"),
    commandConfigHash: encoder.encode("command-config-hash"),
    expiresAt: "2026-06-12T10:01:00Z",
    issuedAt: "2026-06-12T10:00:00Z",
    keyEnvelopeSuite: "hpke-x25519-hkdf-sha256-aes-256-gcm",
    payloadSuite: "aes-256-gcm",
    projectId: "project-1",
    protocolVersion: "webtty-1",
    serverEncryptionKeyId: encoder.encode("server-encryption-key-id"),
    serverId: "server-1",
    serverNonce: encoder.encode("nonce-1"),
    serverSigningKeyId: encoder.encode("server-signing-key-id"),
    sessionId: "session-1",
    sessionKeyGrantHash: encoder.encode("session-key-grant-hash"),
    transport: "websocket",
    workspaceId: "workspace-1",
  };
  const signature = crypto.sign(
    "sha256",
    Buffer.from(webTTYClientProofTranscriptBytes(transcript)),
    { dsaEncoding: "der", key: privateKey },
  );
  assert.equal(
    await verifyWebTTYClientProofTranscript(
      new Uint8Array(publicKeyDER),
      transcript,
      new Uint8Array(signature),
    ),
    true,
  );
  assert.equal(
    await verifyWebTTYClientProofTranscript(
      new Uint8Array(publicKeyDER),
      { ...transcript, clientPrincipalId: "other" },
      new Uint8Array(signature),
    ),
    false,
  );
});

test("WebTTY auth proof verifies Go-style server proof signatures", async () => {
  const encoder = new TextEncoder();
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const publicKeyDER = publicKey.export({ format: "der", type: "spki" });
  const transcript = {
    authRequirement: "client-proof",
    keyEnvelopeSuites: ["hpke-x25519-hkdf-sha256-aes-256-gcm"],
    payloadSuites: ["aes-256-gcm"],
    projectId: "project-1",
    protocolVersion: "webtty-1",
    serverEncryptionKeyId: encoder.encode("server-encryption-key-id"),
    serverId: "server-1",
    serverNonce: encoder.encode("nonce-1"),
    serverSigningKeyId: encoder.encode("server-signing-key-id"),
    sessionId: "session-1",
    signatureSuites: ["ecdsa-p256-sha256"],
    transport: "websocket",
    workspaceId: "workspace-1",
  };
  const signature = crypto.sign(
    "sha256",
    Buffer.from(webTTYServerProofTranscriptBytes(transcript)),
    { dsaEncoding: "der", key: privateKey },
  );
  assert.equal(
    await verifyWebTTYServerProofTranscript(
      new Uint8Array(publicKeyDER),
      transcript,
      new Uint8Array(signature),
    ),
    true,
  );
  assert.equal(
    await verifyWebTTYServerProofTranscript(
      new Uint8Array(publicKeyDER),
      { ...transcript, serverId: "other" },
      new Uint8Array(signature),
    ),
    false,
  );
});

test("WebTTY server proof verification is bound to every advertised security field", async () => {
  const encoder = new TextEncoder();
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const publicKeyDER = publicKey.export({ format: "der", type: "spki" });
  const transcript = {
    authRequirement: "client-proof",
    keyEnvelopeSuites: ["hpke-x25519-hkdf-sha256-aes-256-gcm"],
    payloadSuites: ["aes-256-gcm"],
    projectId: "project-1",
    protocolVersion: "webtty-1",
    serverEncryptionKeyId: encoder.encode("server-encryption-key-id"),
    serverId: "server-1",
    serverNonce: encoder.encode("nonce-1"),
    serverSigningKeyId: encoder.encode("server-signing-key-id"),
    sessionId: "session-1",
    signatureSuites: ["ecdsa-p256-sha256"],
    transport: "websocket",
    workspaceId: "workspace-1",
  };
  const signature = crypto.sign(
    "sha256",
    Buffer.from(webTTYServerProofTranscriptBytes(transcript)),
    { dsaEncoding: "der", key: privateKey },
  );
  const mutations = [
    ["authRequirement", { ...transcript, authRequirement: "none" }],
    [
      "keyEnvelopeSuites",
      {
        ...transcript,
        keyEnvelopeSuites: [
          "hpke-x25519-hkdf-sha256-chacha20-poly1305",
        ],
      },
    ],
    ["payloadSuites", { ...transcript, payloadSuites: ["chacha20-poly1305"] }],
    ["projectId", { ...transcript, projectId: "project-2" }],
    [
      "serverEncryptionKeyId",
      {
        ...transcript,
        serverEncryptionKeyId: encoder.encode("other-server-encryption-key"),
      },
    ],
    ["serverId", { ...transcript, serverId: "server-2" }],
    ["serverNonce", { ...transcript, serverNonce: encoder.encode("nonce-2") }],
    [
      "serverSigningKeyId",
      {
        ...transcript,
        serverSigningKeyId: encoder.encode("other-server-signing-key"),
      },
    ],
    ["sessionId", { ...transcript, sessionId: "session-2" }],
    ["signatureSuites", { ...transcript, signatureSuites: [] }],
    ["transport", { ...transcript, transport: "webtransport" }],
    ["workspaceId", { ...transcript, workspaceId: "workspace-2" }],
  ];
  for (const [field, mutated] of mutations) {
    assert.equal(
      await verifyWebTTYServerProofTranscript(
        new Uint8Array(publicKeyDER),
        mutated,
        new Uint8Array(signature),
      ),
      false,
      `server proof accepted mutated ${field}`,
    );
  }
});

function writeKnownServerKeysFile(home, identity) {
  const filePath = path.join(
    home,
    ".rstream",
    "webtty",
    "known_servers.json",
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        version: 1,
        crypto_suite: "webtty-e2e-x25519-hpke-aes-256-gcm-v1",
        known_servers: [
          {
            name: "runtime",
            key_id: encodeWebTTYE2EKeyMaterial(identity.keyId),
            public_key: encodeWebTTYE2EKeyMaterial(identity.publicKey),
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  return filePath;
}

test("WebTTY opens a protobuf session and sends interactive client messages", () => {
  withFakeWebSocket(() => {
    const connected = [];
    const client = new WebTTY(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      {
        cmdArgs: ["bash", "-lc", "id"],
        envVars: [{ key: "TERM", value: "xterm-256color" }],
        username: "alice",
        workdir: "/srv/app",
      },
      { onConnect: () => connected.push(true) },
    );
    const ws = connect(client);
    assert.equal(ws.url, "wss://terminal.example.test/session");
    assert.equal(ws.binaryType, "arraybuffer");
    const open = decode(ws.sent[0]);
    assert.deepEqual(open.open.config.cmdArgs, ["bash", "-lc", "id"]);
    assert.deepEqual(
      open.open.config.envVars.map((entry) => entry.toJSON()),
      [{ key: "TERM", value: "xterm-256color" }],
    );
    assert.equal(open.open.config.options.interactive, true);
    assert.equal(open.open.config.options.allocateTty, true);
    assert.equal(open.open.config.options.sendHeartbeat, false);
    assert.equal(open.open.config.username.name, "alice");
    assert.equal(open.open.config.workdir.value, "/srv/app");
    assert.deepEqual(connected, [true]);
    client.writeStdin(new Uint8Array([65, 66]));
    assert.deepEqual(Array.from(decode(ws.sent[1]).data.data), [65, 66]);
    client.closeStdin();
    assert.ok(decode(ws.sent[2]).data.eos);
    client.resize(24, 80, 800, 600);
    assert.deepEqual(decode(ws.sent[3]).parameter.terminalSize.toJSON(), {
      col: 80,
      row: 24,
      xpixel: 800,
      ypixel: 600,
    });
  });
});

test("WebTTY rejects non-binary WebSocket payloads with an explicit error", async () => {
  await withAsyncFakeWebSocket(async () => {
    const errors = [];
    const client = new WebTTY(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      undefined,
      { onError: (message) => errors.push(message) },
    );
    client.connect();
    const ws = await firstFakeWebSocket();
    ws.dispatch("open");
    ws.dispatch("message", { data: { unexpected: "object" } });
    await ws.waitForClose();
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Unsupported WebTTY message payload type/);
    assert.equal(ws.closeCalls, 1);
  });
});

test("WebTTY opens a WebTransport session with length-prefixed frames", async () => {
  await withAsyncFakeWebTransport(async () => {
    const connected = [];
    const client = new WebTTY(
      {
        sendHeartbeat: false,
        transport: "webtransport",
        url: "https://terminal.example.test/session",
        webTransportOptions: {
          serverCertificateHashes: [
            { algorithm: "sha-256", value: new Uint8Array([1, 2, 3]) },
          ],
        },
      },
      {
        cmdArgs: ["bash", "-lc", "id"],
        interactive: true,
      },
      { onConnect: () => connected.push(true) },
    );
    client.connect();
    const transport = await firstFakeWebTransport();
    assert.equal(transport.url, "https://terminal.example.test/session");
    assert.deepEqual(transport.options, {
      serverCertificateHashes: [
        { algorithm: "sha-256", value: new Uint8Array([1, 2, 3]) },
      ],
    });
    const open = decodeFrame(await webTransportFrame(transport.stream, 0));
    assert.deepEqual(open.open.config.cmdArgs, ["bash", "-lc", "id"]);
    assert.equal(open.open.config.options.interactive, true);
    transport.stream.dispatch(encode({ ack: {} }));
    await flushAsyncHandlers();
    assert.deepEqual(connected, [true]);
    client.writeStdin(new Uint8Array([65, 66]));
    const stdin = decodeFrame(await webTransportFrame(transport.stream, 1));
    assert.deepEqual(Array.from(stdin.data.data), [65, 66]);
  });
});

test("WebTTY keeps WebSocket as the default transport for HTTP URLs", () => {
  withFakeWebSocket(() => {
    const client = new WebTTY({
      sendHeartbeat: false,
      url: "https://terminal.example.test/session",
    });
    const ws = connect(client);
    assert.equal(ws.url, "wss://terminal.example.test/session");
    assert.equal(FakeWebSocket.instances.length, 1);
  });
});

test("WebTTY normalizes HTTP WebSocket URLs and rejects unsupported schemes", () => {
  withFakeWebSocket(() => {
    const httpClient = new WebTTY({
      sendHeartbeat: false,
      url: "http://terminal.example.test/session",
    });
    assert.equal(connect(httpClient).url, "ws://terminal.example.test/session");
    const objectClient = new WebTTY({
      sendHeartbeat: false,
      url: new URL("https://terminal.example.test/object"),
    });
    objectClient.connect();
    assert.equal(
      acknowledge(FakeWebSocket.instances[1]).url,
      "wss://terminal.example.test/object",
    );
    const invalid = new WebTTY({
      sendHeartbeat: false,
      url: "ftp://terminal.example.test/session",
    });
    assert.throws(() => invalid.connect(), /Unsupported WebSocket WebTTY URL/);
  });
});

test("WebTTY advertises custom payload crypto and sends encrypted stdin payloads", () => {
  withFakeWebSocket(() => {
    const client = new WebTTY(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      {
        payloadCrypto: {
          encryptStdin: (chunk) => ({
            ciphertext: new Uint8Array([...chunk].map((byte) => byte + 1)),
            payloadCrypto: {
              aadContext: new Uint8Array([8]),
              nonce: new Uint8Array([11]),
              payloadKeyId: new Uint8Array([10]),
              payloadSuite: "aes-256-gcm",
            },
            plaintextLength: chunk.byteLength,
          }),
        },
      },
    );
    const ws = connect(client);
    const open = decode(ws.sent[0]);
    assert.deepEqual(open.open.capabilities, [1]);
    assert.equal(open.open.sessionKeyGrant, null);
    client.writeStdin(new Uint8Array([65, 66]));
    const encrypted = decode(ws.sent[1]).data.encryptedData;
    assert.deepEqual(Array.from(encrypted.ciphertext), [66, 67]);
    assert.equal(encrypted.plaintextLength, 2);
    assert.equal(encrypted.payloadCrypto.payloadSuite, 1);
    assert.deepEqual(Array.from(encrypted.payloadCrypto.payloadKeyId), [10]);
    assert.deepEqual(Array.from(encrypted.payloadCrypto.nonce), [11]);
    assert.deepEqual(Array.from(encrypted.payloadCrypto.aadContext), [8]);
  });
});

test("WebTTY E2E payload crypto encrypts and decrypts stream payloads", async () => {
  const identity = await generateWebTTYE2EIdentity();
  const clientCrypto = await createWebTTYE2EClientPayloadCrypto({
    keyContext: new TextEncoder().encode("test/session"),
    recipients: [{ keyId: identity.keyId, publicKey: identity.publicKey }],
  });
  const serverCrypto = await createWebTTYE2EServerPayloadCrypto(
    clientCrypto.sessionKeyGrant,
    identity,
  );
  assert.deepEqual(clientCrypto.cryptoInfo, {
    keyAgreement: "HPKE X25519",
    keyDerivation: "HKDF-SHA256",
    keyEncryption: "AES-256-GCM",
    keyEnvelopeSuite: "hpke-x25519-hkdf-sha256-aes-256-gcm",
    mode: "end-to-end",
    payloadCipher: "AES-256-GCM",
    payloadKeyId: clientCrypto.sessionKeyGrant.payloadKeyId,
    payloadNonceBits: 96,
    payloadSuite: "aes-256-gcm",
    payloadTagBits: 128,
  });
  assert.deepEqual(serverCrypto.cryptoInfo, clientCrypto.cryptoInfo);
  const plaintext = new TextEncoder().encode("typed");
  const stdin = await clientCrypto.encryptStdin(plaintext);
  assert.notDeepEqual(Array.from(stdin.ciphertext), Array.from(plaintext));
  assert.equal(stdin.payloadCrypto.payloadSuite, "aes-256-gcm");
  assert.equal(stdin.payloadCrypto.nonce.byteLength, 12);
  assert.deepEqual(
    Array.from(await serverCrypto.decryptStdin(stdin)),
    Array.from(plaintext),
  );
  const stdout = await serverCrypto.encryptStdout(
    new TextEncoder().encode("output"),
  );
  await assert.rejects(() => clientCrypto.decryptStderr(stdout));
  await assert.rejects(
    () =>
      clientCrypto.decryptStdout({
        ...stdout,
        payloadCrypto: {
          ...stdout.payloadCrypto,
          payloadSuite: "chacha20-poly1305",
        },
      }),
    /payload suite/,
  );
  assert.equal(
    new TextDecoder().decode(await clientCrypto.decryptStdout(stdout)),
    "output",
  );
});

test("WebTTY E2E payload crypto accepts base64url key material", async () => {
  const identity = await generateWebTTYE2EIdentity();
  const encodedIdentity = {
    keyId: b64url(identity.keyId),
    privateKey: b64url(identity.privateKey),
    publicKey: b64url(identity.publicKey),
  };
  const payloadKey = new Uint8Array(32).fill(7);
  const payloadKeyId = new Uint8Array(16).fill(8);
  const clientCrypto = await createWebTTYE2EClientPayloadCrypto({
    keyContext: "workspace/session",
    payloadKey: b64url(payloadKey),
    payloadKeyId: b64url(payloadKeyId),
    recipients: [
      { keyId: encodedIdentity.keyId, publicKey: encodedIdentity.publicKey },
    ],
  });
  assert.equal(
    new TextDecoder().decode(clientCrypto.sessionKeyGrant.keyContext),
    "workspace/session",
  );
  assert.deepEqual(
    Array.from(clientCrypto.sessionKeyGrant.payloadKeyId),
    Array.from(payloadKeyId),
  );
  const serverCrypto = await createWebTTYE2EServerPayloadCrypto(
    clientCrypto.sessionKeyGrant,
    encodedIdentity,
  );
  const encrypted = await clientCrypto.encryptStdin(
    new TextEncoder().encode("base64url"),
  );
  assert.equal(
    new TextDecoder().decode(await serverCrypto.decryptStdin(encrypted)),
    "base64url",
  );
});

test("WebTTY E2E payload crypto builds typed recipient key context", async () => {
  const identity = await generateWebTTYE2EIdentity();
  const clientCrypto = await createWebTTYE2EClientPayloadCrypto({
    recipients: [
      {
        id: "keyset-1",
        keyId: identity.keyId,
        kind: "workspace_keyset",
        publicKey: identity.publicKey,
      },
    ],
  });
  const keyContext = JSON.parse(
    new TextDecoder().decode(clientCrypto.sessionKeyGrant.keyContext),
  );
  assert.deepEqual(keyContext, {
    v: 1,
    type: "rstream.webtty.session_key_grant",
    recipients: [
      {
        key_id: b64url(identity.keyId),
        kind: "workspace_keyset",
        id: "keyset-1",
      },
    ],
  });
  const serverCrypto = await createWebTTYE2EServerPayloadCrypto(
    clientCrypto.sessionKeyGrant,
    identity,
  );
  const encrypted = await clientCrypto.encryptStdin(
    new TextEncoder().encode("typed-recipient"),
  );
  assert.equal(
    new TextDecoder().decode(await serverCrypto.decryptStdin(encrypted)),
    "typed-recipient",
  );
});

test("WebTTY E2E key context helper preserves product identifiers", async () => {
  const identity = await generateWebTTYE2EIdentity();
  const context = JSON.parse(
    new TextDecoder().decode(
      createWebTTYE2EKeyContext({
        workspaceId: "workspace-1",
        projectId: "project-1",
        serverId: "server-1",
        recipients: [
          {
            id: "server-1",
            keyId: identity.keyId,
            kind: "server",
          },
        ],
      }),
    ),
  );
  assert.deepEqual(context, {
    v: 1,
    type: "rstream.webtty.session_key_grant",
    workspace_id: "workspace-1",
    project_id: "project-1",
    server_id: "server-1",
    recipients: [
      {
        key_id: b64url(identity.keyId),
        kind: "server",
        id: "server-1",
      },
    ],
  });
});

test("WebTTY E2E key material helpers round-trip generated identities", async () => {
  const identity = await generateWebTTYE2EIdentity();
  const encoded = {
    keyId: encodeWebTTYE2EKeyMaterial(identity.keyId),
    privateKey: encodeWebTTYE2EKeyMaterial(identity.privateKey),
    publicKey: encodeWebTTYE2EKeyMaterial(identity.publicKey),
  };
  assert.match(encoded.keyId, /^[A-Za-z0-9_-]+$/);
  assert.match(encoded.privateKey, /^[A-Za-z0-9_-]+$/);
  assert.match(encoded.publicKey, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(
    Array.from(decodeWebTTYE2EKeyMaterial(encoded.keyId)),
    Array.from(identity.keyId),
  );
  assert.deepEqual(
    Array.from(decodeWebTTYE2EKeyMaterial(encoded.privateKey)),
    Array.from(identity.privateKey),
  );
  assert.deepEqual(
    Array.from(decodeWebTTYE2EKeyMaterial(encoded.publicKey)),
    Array.from(identity.publicKey),
  );
});

test("WebTTY E2E key material helper rejects non-canonical input", () => {
  assert.throws(() => decodeWebTTYE2EKeyMaterial("AQ=="), /key material/);
  assert.throws(() => decodeWebTTYE2EKeyMaterial("AQ+"), /key material/);
});

test("WebTTY local trust helper loads default known servers", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rstream-webtty-js-"));
  try {
    const identity = await generateWebTTYE2EIdentity();
    const knownServersFile = writeKnownServerKeysFile(home, identity);
    const recipients = await loadWebTTYKnownServerKeysFile(knownServersFile);
    assert.equal(recipients.length, 1);
    assert.deepEqual(Array.from(recipients[0].keyId), Array.from(identity.keyId));
    const clientCrypto =
      await createWebTTYE2EClientPayloadCryptoFromLocalTrust({
        env: { HOME: home },
        keyContext: "local-trust",
      });
    assert.ok(clientCrypto);
    const serverCrypto = await createWebTTYE2EServerPayloadCrypto(
      clientCrypto.sessionKeyGrant,
      identity,
    );
    const encrypted = await clientCrypto.encryptStdin(
      new TextEncoder().encode("local-trust"),
    );
    assert.equal(
      new TextDecoder().decode(await serverCrypto.decryptStdin(encrypted)),
      "local-trust",
    );
  } finally {
    fs.rmSync(home, { force: true, recursive: true });
  }
});

test("WebTTY local trust helper filters default known servers by target", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rstream-webtty-js-"));
  try {
    const selected = await generateWebTTYE2EIdentity();
    const other = await generateWebTTYE2EIdentity();
    const filePath = path.join(
      home,
      ".rstream",
      "webtty",
      "known_servers.json",
    );
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      `${JSON.stringify(
        {
          version: 1,
          crypto_suite: "webtty-e2e-x25519-hpke-aes-256-gcm-v1",
          known_servers: [
            {
              name: "selected",
              key_id: encodeWebTTYE2EKeyMaterial(selected.keyId),
              public_key: encodeWebTTYE2EKeyMaterial(selected.publicKey),
              client_identity: "operator-laptop",
            },
            {
              name: "other",
              key_id: encodeWebTTYE2EKeyMaterial(other.keyId),
              public_key: encodeWebTTYE2EKeyMaterial(other.publicKey),
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
    const clientCrypto =
      await createWebTTYE2EClientPayloadCryptoFromLocalTrust({
        env: { HOME: home },
        target: "selected",
      });
    assert.ok(clientCrypto);
    assert.equal(clientCrypto.sessionKeyGrant.keyEnvelopes.length, 1);
    assert.deepEqual(
      Array.from(clientCrypto.sessionKeyGrant.keyEnvelopes[0].recipientKeyId),
      Array.from(selected.keyId),
    );
  } finally {
    fs.rmSync(home, { force: true, recursive: true });
  }
});

test("WebTTY local trust helper supports env keys and fail-closed mode", async () => {
  const identity = await generateWebTTYE2EIdentity();
  const barePublicKey = encodeWebTTYE2EKeyMaterial(identity.publicKey);
  const parsed = await parseWebTTYKnownServerKey(barePublicKey);
  assert.deepEqual(Array.from(parsed.keyId), Array.from(identity.keyId));
  const clientCrypto =
    await createWebTTYE2EClientPayloadCryptoFromLocalTrust({
      env: { RSTREAM_WEBTTY_KNOWN_SERVER_KEY: barePublicKey },
    });
  assert.ok(clientCrypto);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rstream-webtty-js-"));
  try {
    assert.equal(
      await createWebTTYE2EClientPayloadCryptoFromLocalTrust({
        env: { HOME: home },
      }),
      undefined,
    );
    await assert.rejects(
      () =>
        createWebTTYE2EClientPayloadCryptoFromLocalTrust({
          env: { HOME: home },
          required: true,
        }),
      /E2E client mode requires/,
    );
  } finally {
    fs.rmSync(home, { force: true, recursive: true });
  }
});

test("WebTTY local trust helper rejects mismatched key ids", async () => {
  const identity = await generateWebTTYE2EIdentity();
  const other = await generateWebTTYE2EIdentity();
  await assert.rejects(
    () =>
      parseWebTTYKnownServerKey(
        `${encodeWebTTYE2EKeyMaterial(other.keyId)}:${encodeWebTTYE2EKeyMaterial(identity.publicKey)}`,
      ),
    /key id does not match public key/,
  );
});

test("WebTTY replay decrypts engine-recorded E2E event JSON", async () => {
  const identity = await generateWebTTYE2EIdentity();
  const clientCrypto = await createWebTTYE2EClientPayloadCrypto({
    keyContext: "workspace/session",
    recipients: [{ keyId: identity.keyId, publicKey: identity.publicKey }],
  });
  const serverCrypto = await createWebTTYE2EServerPayloadCrypto(
    clientCrypto.sessionKeyGrant,
    identity,
  );
  const encrypted = await serverCrypto.encryptStdout(
    new TextEncoder().encode("recorded-output"),
  );
  const event = {
    crypto: {
      key_context: {
        encoding: "base64",
        value: b64url(new TextEncoder().encode("wrong-context")),
      },
      key_context_raw: b64url(encrypted.payloadCrypto.aadContext),
      nonce: b64url(encrypted.payloadCrypto.nonce),
      payload_key_id: b64url(encrypted.payloadCrypto.payloadKeyId),
      payload_suite: encrypted.payloadCrypto.payloadSuite,
    },
    payload_ciphertext: Buffer.from(encrypted.ciphertext).toString("base64"),
    payload_length: encrypted.plaintextLength,
    stream_type: "stdout",
    type: "data",
  };
  const payload = webTTYRecordedEventEncryptedPayload(event);
  assert.equal(payload.plaintextLength, encrypted.plaintextLength);
  const chunk = await decryptWebTTYRecordedEvent(event, clientCrypto);
  assert.equal(chunk.stream, "stdout");
  assert.equal(new TextDecoder().decode(chunk.data), "recorded-output");
});

test("WebTTY replay rejects malformed base64 event material", () => {
  assert.throws(
    () =>
      webTTYRecordedEventEncryptedPayload({
        payload_ciphertext: "not*base64",
        payload_length: 1,
        type: "data",
      }),
    /invalid base64/,
  );
});

test("WebTTY replay builds payload crypto from engine key grant decrypt material", async () => {
  const identity = await generateWebTTYE2EIdentity();
  const clientCrypto = await createWebTTYE2EClientPayloadCrypto({
    keyContext: "workspace/session",
    recipients: [{ keyId: identity.keyId, publicKey: identity.publicKey }],
  });
  const serverCrypto = await createWebTTYE2EServerPayloadCrypto(
    clientCrypto.sessionKeyGrant,
    identity,
  );
  const encrypted = await serverCrypto.encryptStdout(
    new TextEncoder().encode("grant-recorded-output"),
  );
  const sessionEnvelope = clientCrypto.sessionKeyGrant.keyEnvelopes[0];
  const grant = {
    crypto: {
      key_context_raw: b64url(clientCrypto.sessionKeyGrant.keyContext),
      key_envelope_suite: clientCrypto.sessionKeyGrant.keyEnvelopeSuite,
      key_envelopes: [
        {
          encapsulated_key: b64url(sessionEnvelope.encapsulatedKey),
          recipient_key_id: b64url(sessionEnvelope.recipientKeyId),
        },
      ],
      payload_key_id: b64url(clientCrypto.sessionKeyGrant.payloadKeyId),
      payload_suite: clientCrypto.sessionKeyGrant.payloadSuite,
    },
    recipient_id: "device-1",
    recipient_kind: "workspace_device",
    wrapped_key: Buffer.from(sessionEnvelope.wrappedKey).toString("base64"),
  };
  const replayCrypto =
    await createWebTTYE2EReplayPayloadCryptoFromKeyGrant(grant, identity);
  const event = {
    crypto: {
      key_context_raw: b64url(encrypted.payloadCrypto.aadContext),
      nonce: b64url(encrypted.payloadCrypto.nonce),
      payload_key_id: b64url(encrypted.payloadCrypto.payloadKeyId),
      payload_suite: encrypted.payloadCrypto.payloadSuite,
    },
    payload_ciphertext: Buffer.from(encrypted.ciphertext).toString("base64"),
    payload_length: encrypted.plaintextLength,
    stream_type: "stdout",
    type: "data",
  };
  const chunk = await decryptWebTTYRecordedEvent(event, replayCrypto);
  assert.equal(chunk.stream, "stdout");
  assert.equal(new TextDecoder().decode(chunk.data), "grant-recorded-output");
});

test("WebTTY text log drops closed alternate-screen content like terminal scrollback", async () => {
  const events = [
    {
      payload_plaintext: new TextEncoder().encode(
        "prompt$ htop\r\n\x1b[?1049h\x1b[2J\x1b[HHTOP SCREEN\nPID USER\n\x1b[?1049lprompt$ echo done\r\ndone\r\n",
      ),
      stream_type: "stdout",
      type: "data",
    },
  ];
  const log = await decryptWebTTYRecordedTextLog(events, {});
  assert.equal(log.detectedAlternateScreen, true);
  assert.deepEqual(log.warnings, ["alternate-screen"]);
  assert.match(log.text, /prompt\$ htop/);
  assert.match(log.text, /terminal alternate screen entered/);
  assert.match(log.text, /terminal alternate screen left/);
  assert.match(log.text, /prompt\$ echo done/);
  assert.match(log.text, /done/);
  assert.doesNotMatch(log.text, /HTOP SCREEN/);
  assert.doesNotMatch(log.text, /PID USER/);
});

test("WebTTY text log includes active alternate-screen snapshot", async () => {
  const events = [
    {
      payload_plaintext: new TextEncoder().encode(
        "prompt$ htop\r\n\x1b[?1049h\x1b[2J\x1b[HCPU 42%\nPID USER\n",
      ),
      stream_type: "stdout",
      type: "data",
    },
  ];
  const log = await decryptWebTTYRecordedTextLog(events, {});
  assert.equal(log.detectedAlternateScreen, true);
  assert.match(log.text, /prompt\$ htop/);
  assert.match(log.text, /terminal alternate screen active/);
  assert.match(log.text, /CPU 42%/);
  assert.match(log.text, /PID USER/);
});

test("WebTTY text log can render resize markers", () => {
  const log = renderWebTTYRecordedTextLog(
    [
      {
        metadata: { terminal_size: { col: 132, row: 43 } },
        type: "resize",
      },
    ],
    [],
    { includeResizeMarkers: true },
  );
  assert.match(log.text, /terminal resized to 132x43/);
});

test("WebTTY E2E payload crypto rejects invalid key identifiers", async () => {
  const identity = await generateWebTTYE2EIdentity();
  await assert.rejects(
    () =>
      createWebTTYE2EClientPayloadCrypto({
        payloadKeyId: new Uint8Array([1, 2, 3]),
        recipients: [{ keyId: identity.keyId, publicKey: identity.publicKey }],
      }),
    /payload key id/,
  );
  await assert.rejects(
    () =>
      createWebTTYE2EClientPayloadCrypto({
        recipients: [
          { keyId: new Uint8Array([1, 2, 3]), publicKey: identity.publicKey },
        ],
      }),
    /recipient key id/,
  );
  const clientCrypto = await createWebTTYE2EClientPayloadCrypto({
    recipients: [{ keyId: identity.keyId, publicKey: identity.publicKey }],
  });
  await assert.rejects(
    () =>
      createWebTTYE2EServerPayloadCrypto(
        { ...clientCrypto.sessionKeyGrant, payloadKeyId: new Uint8Array([1]) },
        identity,
      ),
    /payload key id/,
  );
  await assert.rejects(
    () =>
      createWebTTYE2EServerPayloadCrypto(clientCrypto.sessionKeyGrant, {
        ...identity,
        keyId: new Uint8Array([1]),
      }),
    /identity key id/,
  );
});

test("WebTTY E2E payload crypto decrypts a Go-generated vector", async () => {
  const identity = {
    keyId: b64("UKCOsilRMxxyr2Co+LEtnw"),
    privateKey: b64("eMHxa0yO6nVvKjPBufEft7XGEJ99yH8tzgGxfOQgtqE"),
    publicKey: b64("ItQnRTeCRJXWJZFAY617vPJewVDp6SA8aMeDl7K3MAs"),
  };
  const serverCrypto = await createWebTTYE2EServerPayloadCrypto(
    {
      keyContext: b64("eyJpbnRlcm9wIjoiZ28tdG8tY3BwIn0"),
      keyEnvelopeSuite: "hpke-x25519-hkdf-sha256-aes-256-gcm",
      keyEnvelopes: [
        {
          encapsulatedKey: b64("plKRWeRF90NZku+yJ0fHRU3x9vq93cUmATSV/2u/7jI"),
          recipientKeyId: b64("UKCOsilRMxxyr2Co+LEtnw"),
          wrappedKey: b64(
            "6ebMdiwG+UGUteo2T5wUfOUfiGNoUIReQsJrDgy45120CctObgh717t6EXN3TQ6d",
          ),
        },
      ],
      payloadKeyId: b64("cGF5bG9hZC1rZXktZ28wMQ"),
      payloadSuite: "aes-256-gcm",
    },
    identity,
  );
  const plaintext = await serverCrypto.decryptStdin({
    ciphertext: b64("mLJnHltxjH82d3WyKKdVdxtJGWyN9YQ9nW4RJZoe7A"),
    payloadCrypto: {
      aadContext: b64("eyJpbnRlcm9wIjoiZ28tdG8tY3BwIn0"),
      nonce: b64("ZH4sxt5HKPV7iYWw"),
      payloadKeyId: b64("cGF5bG9hZC1rZXktZ28wMQ"),
      payloadSuite: "aes-256-gcm",
    },
    plaintextLength: 15,
  });
  assert.equal(new TextDecoder().decode(plaintext), "go-to-cpp-stdin");
});

test("WebTTY rejects E2E session key grants without a known server identity", async () => {
  await withAsyncFakeWebSocket(async () => {
    const identity = await generateWebTTYE2EIdentity();
    const clientCrypto = await createWebTTYE2EClientPayloadCrypto({
      keyContext: new TextEncoder().encode("wire/session"),
      recipients: [{ keyId: identity.keyId, publicKey: identity.publicKey }],
    });
    assert.throws(
      () =>
        new WebTTY(
          { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
          { payloadCrypto: clientCrypto },
        ),
      /known server endpoint identity/,
    );
  });
});

test("WebTTY reports actionable authenticated E2E trust errors", async () => {
  await withAsyncFakeWebSocket(async () => {
    const errors = [];
    const client = new WebTTY(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      undefined,
      { onError: (message) => errors.push(message) },
    );
    client.connect();
    const ws = await firstFakeWebSocket();
    ws.dispatch("open");
    ws.dispatch("message", {
      data: encode({
        serverHello: {
          authRequirement: 2,
          sessionId: "session-1",
        },
      }),
    });
    await ws.waitForClose();
    assert.equal(errors.length, 1);
    assert.match(errors[0], /authenticated E2E/);
    assert.doesNotMatch(errors[0], /Unexpected server hello/);
    assert.equal(ws.closeCalls, 1);
  });
});

test("WebTTY reports missing client endpoint identity after a verified server proof", async () => {
  await withAsyncFakeWebSocket(async () => {
    const encoder = new TextEncoder();
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const signingPublicKey = new Uint8Array(
      publicKey.export({ format: "der", type: "spki" }),
    );
    const encryptionKeyId = encoder.encode("server-encryption-key-id");
    const encryptionPublicKey = encoder.encode("server-encryption-public-key");
    const signingKeyId = encoder.encode("server-signing-key-id");
    const sessionNonce = encoder.encode("nonce-1");
    const transcript = {
      authRequirement: "client-proof",
      keyEnvelopeSuites: ["hpke-x25519-hkdf-sha256-aes-256-gcm"],
      payloadSuites: ["aes-256-gcm"],
      projectId: "project-1",
      protocolVersion: "webtty-1",
      serverEncryptionKeyId: encryptionKeyId,
      serverId: "server-1",
      serverNonce: sessionNonce,
      serverSigningKeyId: signingKeyId,
      sessionId: "session-1",
      signatureSuites: ["ecdsa-p256-sha256"],
      transport: "websocket",
      workspaceId: "workspace-1",
    };
    const signature = crypto.sign(
      "sha256",
      Buffer.from(webTTYServerProofTranscriptBytes(transcript)),
      { dsaEncoding: "der", key: privateKey },
    );
    const errors = [];
    const client = new WebTTY(
      {
        expectedServerIdentity: {
          encryptionKeyId,
          encryptionPublicKey,
          signingKeyId,
          signingPublicKey,
        },
        sendHeartbeat: false,
        url: "wss://terminal.example.test/session",
      },
      undefined,
      { onError: (message) => errors.push(message) },
    );
    client.connect();
    const ws = await firstFakeWebSocket();
    ws.dispatch("open");
    ws.dispatch("message", {
      data: encode({
        serverHello: {
          authRequirement: 2,
          keyEnvelopeSuites: [1],
          payloadSuites: [1],
          projectId: { value: "project-1" },
          protocolVersion: 1,
          serverId: { value: "server-1" },
          serverIdentity: {
            encryptionKeyId,
            encryptionPublicKey,
            keyEnvelopeSuite: 1,
            signatureSuite: 1,
            signingKeyId,
            signingPublicKey,
          },
          serverProof: {
            signature: new Uint8Array(signature),
            signatureSuite: 1,
            signingKeyId,
            transcriptHash: await hashWebTTYServerProofTranscript(transcript),
          },
          sessionId: "session-1",
          sessionNonce,
          signatureSuites: [1],
          workspaceId: { value: "workspace-1" },
        },
      }),
    });
    await ws.waitForClose();
    assert.equal(errors.length, 1);
    assert.match(errors[0], /client proof/);
    assert.match(errors[0], /client endpoint identity/);
    assert.equal(ws.closeCalls, 1);
    assert.equal(ws.sent.length, 0);
  });
});

test("WebTTY writeStdinAsync supports asynchronous payload crypto", async () => {
  await withAsyncFakeWebSocket(async () => {
    const client = new WebTTY(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      {
        payloadCrypto: {
          encryptStdin: async (chunk) => ({
            ciphertext: new Uint8Array([...chunk].reverse()),
            plaintextLength: chunk.byteLength,
          }),
        },
      },
    );
    const ws = connect(client);
    assert.throws(
      () => client.writeStdin(new Uint8Array([1, 2, 3])),
      /writeStdinAsync/,
    );
    await client.writeStdinAsync(new Uint8Array([1, 2, 3]));
    const encrypted = decode(ws.sent[1]).data.encryptedData;
    assert.deepEqual(Array.from(encrypted.ciphertext), [3, 2, 1]);
    assert.equal(encrypted.plaintextLength, 3);
  });
});

test("WebTTY decrypts encrypted stdout and stderr payloads", async () => {
  await withAsyncFakeWebSocket(async () => {
    const events = [];
    const client = new WebTTY(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      {
        payloadCrypto: {
          decryptStderr: async (payload) =>
            Buffer.from(`err:${Buffer.from(payload.ciphertext).toString()}`),
          decryptStdout: async (payload) =>
            Buffer.from(`out:${Buffer.from(payload.ciphertext).toString()}`),
        },
      },
      {
        onStderr: (chunk) =>
          events.push(["stderr", Buffer.from(chunk).toString()]),
        onStdout: (chunk) =>
          events.push(["stdout", Buffer.from(chunk).toString()]),
      },
    );
    const ws = connect(client);
    ws.dispatch("message", {
      data: encode({
        data: {
          encryptedData: {
            ciphertext: Buffer.from("one"),
            plaintextLength: 3,
          },
          type: 1,
        },
      }),
    });
    ws.dispatch("message", {
      data: encode({
        data: {
          encryptedData: {
            ciphertext: Buffer.from("two"),
            plaintextLength: 3,
          },
          type: 2,
        },
      }),
    });
    await flushAsyncHandlers();
    assert.deepEqual(events, [
      ["stdout", "out:one"],
      ["stderr", "err:two"],
    ]);
  });
});

test("WebTTY waits for queued async decrypts before classifying transport close", async () => {
  await withAsyncFakeWebSocket(async () => {
    const events = [];
    const client = new WebTTY(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      {
        payloadCrypto: {
          decryptStderr: async (payload) =>
            Buffer.from(`err:${Buffer.from(payload.ciphertext).toString()}`),
          decryptStdout: async (payload) =>
            Buffer.from(`out:${Buffer.from(payload.ciphertext).toString()}`),
        },
      },
      {
        onComplete: (code) => events.push(["complete", code]),
        onError: (error) => events.push(["error", error]),
        onStderr: (chunk) =>
          events.push(["stderr", Buffer.from(chunk).toString()]),
        onStdout: (chunk) =>
          events.push(["stdout", Buffer.from(chunk).toString()]),
      },
    );
    const ws = connect(client);
    ws.dispatch("message", {
      data: encode({
        data: {
          encryptedData: {
            ciphertext: Buffer.from("one"),
            plaintextLength: 3,
          },
          type: 1,
        },
      }),
    });
    ws.dispatch("message", {
      data: encode({
        data: {
          encryptedData: {
            ciphertext: Buffer.from("two"),
            plaintextLength: 3,
          },
          type: 2,
        },
      }),
    });
    ws.dispatch("message", { data: encode({ close: { returnCode: 0 } }) });
    ws.dispatch("close");
    await flushAsyncHandlers();
    await flushAsyncHandlers();
    assert.deepEqual(events, [
      ["stdout", "out:one"],
      ["stderr", "err:two"],
      ["complete", 0],
    ]);
  });
});

test("WebTTY fails closed when encrypted output has no decrypt hook", async () => {
  await withAsyncFakeWebSocket(async () => {
    const errors = [];
    const client = new WebTTY(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      undefined,
      { onError: (error) => errors.push(error) },
    );
    const ws = connect(client);
    ws.dispatch("message", {
      data: encode({
        data: {
          encryptedData: {
            ciphertext: Buffer.from("secret"),
            plaintextLength: 6,
          },
          type: 1,
        },
      }),
    });
    await flushAsyncHandlers();
    assert.deepEqual(errors, [
      "Encrypted WebTTY stdout payload requires a decrypt hook.",
    ]);
    assert.equal(ws.closeCalls, 1);
  });
});

test("WebTTY ignores explicit undefined options when applying defaults", () => {
  withFakeWebSocket(() => {
    const client = new WebTTY(
      {
        heartbeatIntervalMs: undefined,
        sendHeartbeat: undefined,
        url: "wss://terminal.example.test/session",
      },
      {
        allocateTty: undefined,
        envVars: undefined,
        interactive: undefined,
      },
    );
    const ws = connect(client);
    const open = decode(ws.sent[0]);
    assert.deepEqual(open.open.config.envVars, []);
    assert.equal(open.open.config.options.interactive, true);
    assert.equal(open.open.config.options.allocateTty, true);
    assert.equal(open.open.config.options.sendHeartbeat, true);
    client.disconnect();
  });
});

test("WebTTY dispatches stdout stderr EOS and remote close events exactly once", () => {
  withFakeWebSocket(() => {
    const events = [];
    const client = new WebTTY(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      undefined,
      {
        onComplete: (code) => events.push(["complete", code]),
        onStderr: (chunk) =>
          events.push(["stderr", Buffer.from(chunk).toString()]),
        onStderrEos: () => events.push(["stderr-eos"]),
        onStdout: (chunk) =>
          events.push(["stdout", Buffer.from(chunk).toString()]),
        onStdoutEos: () => events.push(["stdout-eos"]),
      },
    );
    const ws = connect(client);
    ws.dispatch("message", {
      data: encode({ data: { data: Buffer.from("out"), type: 1 } }),
    });
    ws.dispatch("message", { data: encode({ data: { eos: {}, type: 1 } }) });
    ws.dispatch("message", {
      data: encode({ data: { data: Buffer.from("err"), type: 2 } }),
    });
    ws.dispatch("message", { data: encode({ data: { eos: {}, type: 2 } }) });
    ws.dispatch("message", { data: encode({ close: { returnCode: 7 } }) });
    ws.dispatch("close");
    assert.deepEqual(events, [
      ["stdout", "out"],
      ["stdout-eos"],
      ["stderr", "err"],
      ["stderr-eos"],
      ["complete", 7],
    ]);
    assert.equal(ws.closeCalls, 1);
  });
});

test("WebTTY fails closed for invalid states and malformed server messages", () => {
  withFakeWebSocket(() => {
    const errors = [];
    const client = new WebTTY(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      { allocateTty: false, interactive: false },
      { onError: (error) => errors.push(error) },
    );
    assert.throws(
      () => client.writeStdin(new Uint8Array([1])),
      /Invalid state/,
    );
    const ws = connect(client);
    assert.throws(() => client.writeStdin(new Uint8Array([1])), /STDIN/);
    assert.throws(() => client.closeStdin(), /STDIN/);
    assert.throws(() => client.resize(24, 80), /Resize/);
    ws.dispatch("message", { data: Buffer.from([255]) });
    assert.match(errors[0], /^Failed to decode message:/);
  });
});

test("WebTTY closes unexpected pre-ACK data instead of processing it", () => {
  withFakeWebSocket(() => {
    const errors = [];
    const client = new WebTTY(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      undefined,
      { onError: (error) => errors.push(error) },
    );
    client.connect();
    const ws = FakeWebSocket.instances[0];
    ws.dispatch("open");
    ws.dispatch("message", {
      data: encode({ data: { data: Buffer.from("early"), type: 1 } }),
    });
    assert.deepEqual(errors, ["Unexpected data message."]);
    assert.equal(ws.closeCalls, 1);
  });
});

test("WebTTY proto encodes managed session attach metadata", () => {
  const decoded = decode(
    encode({
      attach: {
        attachGrant: Buffer.from("grant"),
        browserId: { value: "browser-1" },
        capabilities: [1, 2],
        deviceId: { value: "device-1" },
        participantId: "participant-1",
        requestedRole: 1,
        sessionId: "session-1",
        transport: 2,
      },
    }),
  );
  assert.equal(decoded.attach.sessionId, "session-1");
  assert.equal(decoded.attach.participantId, "participant-1");
  assert.deepEqual(
    Array.from(decoded.attach.attachGrant),
    Array.from(Buffer.from("grant")),
  );
  assert.equal(decoded.attach.requestedRole, 1);
  assert.equal(decoded.attach.transport, 2);
  assert.deepEqual(decoded.attach.capabilities, [1, 2]);
  assert.equal(decoded.attach.deviceId.value, "device-1");
  assert.equal(decoded.attach.browserId.value, "browser-1");
});

test("WebTTY sends managed session attach over WebSocket", async () => {
  await withAsyncFakeWebSocket(async () => {
    const connected = [];
    const client = new WebTTY(
      {
        attach: {
          attachGrant: Buffer.from("grant"),
          browserId: " browser-1 ",
          capabilities: ["read_stream", "request_control"],
          deviceId: " device-1 ",
          participantId: " participant-1 ",
          requestedRole: "spectator",
          sessionId: " session-1 ",
        },
        sendHeartbeat: false,
        url: "wss://terminal.example.test/session",
      },
      undefined,
      { onConnect: () => connected.push(true) },
    );
    client.connect();
    const ws = FakeWebSocket.instances[0];
    ws.dispatch("open");
    const sent = await fakeWebSocketSent(ws, 0);
    assert.equal(ws.sent.length, 1);
    const decoded = decode(sent);
    assert.equal(decoded.open, null);
    assert.equal(decoded.attach.sessionId, "session-1");
    assert.equal(decoded.attach.participantId, "participant-1");
    assert.deepEqual(Array.from(decoded.attach.attachGrant), [103, 114, 97, 110, 116]);
    assert.equal(decoded.attach.requestedRole, 1);
    assert.equal(decoded.attach.transport, 2);
    assert.deepEqual(decoded.attach.capabilities, [1, 2]);
    assert.equal(decoded.attach.deviceId.value, "device-1");
    assert.equal(decoded.attach.browserId.value, "browser-1");
    ws.dispatch("message", { data: encode({ ack: {} }) });
    assert.deepEqual(connected, [true]);
  });
});

test("WebTTY signs managed session attach with client proof", async () => {
  await withAsyncFakeWebSocket(async () => {
    const endpointIdentity = {
      signing: await generateWebTTYSigningIdentity(),
    };
    const clientCredential = Buffer.from("workspace-device-credential");
    const client = new WebTTY(
      {
        attach: {
          attachGrant: Buffer.from("grant"),
          capabilities: ["read_stream"],
          participantId: "participant-1",
          projectId: "project-1",
          requestedRole: "spectator",
          serverId: "server-1",
          sessionId: "session-1",
          workspaceId: "workspace-1",
        },
        clientCredential,
        clientDeviceId: "device-1",
        clientPrincipalId: "principal-1",
        endpointIdentity,
        sendHeartbeat: false,
        url: "wss://terminal.example.test/session",
      },
      undefined,
    );
    client.connect();
    const ws = await firstFakeWebSocket();
    ws.dispatch("open");
    const sent = await fakeWebSocketSent(ws, 0);
    assert.equal(ws.sent.length, 1);
    const decoded = decode(sent);
    const proof = decoded.attach.clientProof;
    assert.notEqual(proof, null);
    assert.deepEqual(
      Array.from(proof.signingKeyId),
      Array.from(endpointIdentity.signing.keyId),
    );
    assert.deepEqual(
      Array.from(proof.signingPublicKey),
      Array.from(endpointIdentity.signing.publicKey),
    );
    assert.equal(proof.deviceId.value, "device-1");
    assert.equal(proof.principalId.value, "principal-1");
    assert.deepEqual(
      Array.from(proof.credential.value),
      Array.from(clientCredential),
    );
    const transcript = {
      attachGrantHash: await hashWebTTYAttachGrant(decoded.attach.attachGrant),
      authRequirement: "client-proof",
      clientCredentialHash: await hashWebTTYClientCredential(clientCredential),
      clientPrincipalId: "principal-1",
      clientSigningKeyId: endpointIdentity.signing.keyId,
      expiresAt: proof.expiresAt,
      issuedAt: proof.issuedAt,
      keyEnvelopeSuite: "hpke-x25519-hkdf-sha256-aes-256-gcm",
      payloadSuite: "aes-256-gcm",
      projectId: "project-1",
      protocolVersion: "webtty-1",
      requestedRole: "spectator",
      serverId: "server-1",
      sessionId: "session-1",
      transport: "websocket",
      workspaceId: "workspace-1",
    };
    assert.deepEqual(
      Array.from(proof.transcriptHash),
      Array.from(await hashWebTTYClientProofTranscript(transcript)),
    );
    assert.equal(
      await verifyWebTTYClientProofTranscript(
        endpointIdentity.signing.publicKey,
        transcript,
        proof.signature,
      ),
      true,
    );
    assert.equal(
      await verifyWebTTYClientProofTranscript(
        endpointIdentity.signing.publicKey,
        { ...transcript, serverId: "server-2" },
        proof.signature,
      ),
      false,
    );
  });
});

test("WebTTY sends managed session attach over WebTransport", async () => {
  await withAsyncFakeWebTransport(async () => {
    const client = new WebTTY({
      attach: {
        attachGrant: Buffer.from("grant"),
        participantId: "participant-1",
        sessionId: "session-1",
      },
      sendHeartbeat: false,
      transport: "webtransport",
      url: "https://terminal.example.test/session",
    });
    client.connect();
    const transport = await firstFakeWebTransport();
    const frame = await webTransportFrame(transport.stream, 0);
    const decoded = decodeFrame(frame);
    assert.equal(decoded.attach.sessionId, "session-1");
    assert.equal(decoded.attach.participantId, "participant-1");
    assert.equal(decoded.attach.requestedRole, 1);
    assert.equal(decoded.attach.transport, 3);
    assert.deepEqual(decoded.attach.capabilities, [1]);
  });
});

test("WebTTY validates managed session attach configuration", () => {
  assert.throws(
    () =>
      new WebTTY({
        attach: {
          attachGrant: Buffer.from("grant"),
          participantId: "participant-1",
          sessionId: " ",
        },
        url: "wss://terminal.example.test/session",
      }),
    /attach session ID/,
  );
  assert.throws(
    () =>
      new WebTTY({
        attach: {
          attachGrant: Buffer.alloc(0),
          participantId: "participant-1",
          sessionId: "session-1",
        },
        url: "wss://terminal.example.test/session",
      }),
    /attach grant/,
  );
  assert.throws(
    () =>
      new WebTTY({
        attach: {
          attachGrant: Buffer.from("grant"),
          capabilities: ["write_stream"],
          participantId: "participant-1",
          sessionId: "session-1",
        },
        url: "wss://terminal.example.test/session",
      }),
    /attach capability/,
  );
});

test("WebTTY fails closed on unexpected attach messages in open-client mode", () => {
  withFakeWebSocket(() => {
    const errors = [];
    const client = new WebTTY(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      undefined,
      { onError: (error) => errors.push(error) },
    );
    const ws = connect(client);
    ws.dispatch("message", {
      data: encode({
        attach: {
          attachGrant: Buffer.from("grant"),
          participantId: "participant-1",
          requestedRole: 1,
          sessionId: "session-1",
          transport: 2,
        },
      }),
    });
    assert.deepEqual(errors, ["Unexpected attach message."]);
    assert.equal(ws.closeCalls, 1);
  });
});

test("executeWebTTYCommand runs non-interactive commands and collects output", async () => {
  await withAsyncFakeWebSocket(async () => {
    const command = executeWebTTYCommand(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      { cmdArgs: ["sh", "-lc", "printf ok"] },
    );
    const ws = acknowledge(FakeWebSocket.instances[0]);
    const open = decode(ws.sent[0]);
    assert.deepEqual(open.open.config.cmdArgs, ["sh", "-lc", "printf ok"]);
    assert.equal(open.open.config.options.interactive, false);
    assert.equal(open.open.config.options.allocateTty, false);
    ws.dispatch("message", {
      data: encode({ data: { data: Buffer.from("ok"), type: 1 } }),
    });
    ws.dispatch("message", {
      data: encode({ data: { data: Buffer.from("warn"), type: 2 } }),
    });
    ws.dispatch("message", { data: encode({ close: { returnCode: 0 } }) });
    assert.deepEqual(await command, {
      exitCode: 0,
      stderr: "warn",
      stdout: "ok",
      success: true,
    });
  });
});

test("openWebTTYCommand exposes replayable logs streams stdin and wait", async () => {
  await withAsyncFakeWebSocket(async () => {
    const command = openWebTTYCommand(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      { cmdArgs: ["cat"], interactive: true },
    );
    const logs = collectAsync(command.logs());
    const ws = acknowledge(await firstFakeWebSocket());
    await command.writeStdin("payload");
    await command.closeStdin();
    assert.equal(
      Buffer.from(decode(ws.sent[1]).data.data).toString(),
      "payload",
    );
    assert.ok(decode(ws.sent[2]).data.eos);
    ws.dispatch("message", {
      data: encode({ data: { data: Buffer.from("out"), type: 1 } }),
    });
    ws.dispatch("message", {
      data: encode({ data: { data: Buffer.from("err"), type: 2 } }),
    });
    ws.dispatch("message", { data: encode({ close: { returnCode: 3 } }) });
    assert.deepEqual(await command.wait(), { exitCode: 3, success: false });
    assert.equal(await command.stdout(), "out");
    assert.equal(await command.stderr(), "err");
    assert.equal(await command.output("both"), "outerr");
    assert.deepEqual(await logs, [
      { data: "out", stream: "stdout" },
      { data: "err", stream: "stderr" },
    ]);
  });
});

test("runWebTTYCommand maps command args cwd env stdin and exec path", async () => {
  await withAsyncFakeWebSocket(async () => {
    const execution = runWebTTYCommand(
      { sendHeartbeat: false, url: "https://terminal.example.test/base" },
      "sh",
      ["-lc", "printf $CUSTOM"],
      {
        cwd: "/srv/app",
        env: { CUSTOM: "value", SKIP: undefined },
        execPath: "/exec",
        stdin: "input",
      },
    );
    const ws = acknowledge(await firstFakeWebSocket());
    const open = decode(ws.sent[0]);
    assert.equal(ws.url, "wss://terminal.example.test/base/exec");
    assert.deepEqual(open.open.config.cmdArgs, ["sh", "-lc", "printf $CUSTOM"]);
    assert.deepEqual(
      open.open.config.envVars.map((entry) => entry.toJSON()),
      [{ key: "CUSTOM", value: "value" }],
    );
    assert.equal(open.open.config.workdir.value, "/srv/app");
    assert.equal(Buffer.from(decode(ws.sent[1]).data.data).toString(), "input");
    ws.dispatch("message", {
      data: encode({ data: { data: Buffer.from("value"), type: 1 } }),
    });
    ws.dispatch("message", { data: encode({ close: { returnCode: 0 } }) });
    assert.deepEqual(await execution, {
      exitCode: 0,
      stderr: "",
      stdout: "value",
      success: true,
    });
  });
});

test("WebTTYCommand kill closes the session and settles waiters", async () => {
  await withAsyncFakeWebSocket(async () => {
    const command = openWebTTYCommand(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      { cmdArgs: ["sleep", "30"] },
    );
    const ws = acknowledge(await firstFakeWebSocket());
    await command.kill();
    assert.equal(ws.closeCalls, 1);
    await assert.rejects(() => command.wait(), /Session terminated by client/);
  });
});

test("WebTTYRemoteExecutor resolves URLs lazily and sends command input", async () => {
  await withAsyncFakeWebSocket(async () => {
    const executor = new WebTTYRemoteExecutor({
      execPath: "/exec",
      sendHeartbeat: false,
      url: async () => "https://terminal.example.test",
    });
    const command = executor.execute({
      cmdArgs: ["cat"],
      input: "payload",
    });
    const ws = acknowledge(await firstFakeWebSocket());
    assert.equal(ws.url, "wss://terminal.example.test/exec");
    const open = decode(ws.sent[0]);
    assert.equal(open.open.config.options.interactive, true);
    assert.equal(
      Buffer.from(decode(ws.sent[1]).data.data).toString(),
      "payload",
    );
    assert.ok(decode(ws.sent[2]).data.eos);
    ws.dispatch("message", { data: encode({ close: { returnCode: 0 } }) });
    assert.deepEqual(await command, {
      exitCode: 0,
      stderr: "",
      stdout: "",
      success: true,
    });
  });
});

test("resolveWebTTYExecutionURL maps published URLs to discovered exec paths", () => {
  assert.equal(
    resolveWebTTYExecutionURL("https://shell.example").toString(),
    "wss://shell.example/",
  );
  assert.equal(
    resolveWebTTYExecutionURL(
      "wss://shell.example/base?x=1",
      "/exec",
    ).toString(),
    "wss://shell.example/base/exec?x=1",
  );
  assert.throws(
    () => resolveWebTTYExecutionURL("rstrm://shell", "/exec"),
    /native rstream dialer/,
  );
});

test("executeWebTTYCommand reports timeouts clearly", async () => {
  await withAsyncFakeWebSocket(async () => {
    await assert.rejects(
      () =>
        executeWebTTYCommand(
          { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
          { cmdArgs: ["sleep", "10"], timeoutMs: 0 },
        ),
      /timed out/,
    );
  });
});

test("resolveWebTTYFileSystemURL maps WebTTY URLs to the filesystem sidecar", () => {
  assert.equal(
    resolveWebTTYFileSystemURL("wss://shell.example").toString(),
    "https://shell.example/fs",
  );
  assert.equal(
    resolveWebTTYFileSystemURL(
      "https://shell.example/base?x=1",
      "/dir/file with space.txt",
    ).toString(),
    "https://shell.example/base/fs/dir/file%20with%20space.txt?x=1",
  );
  assert.equal(
    resolveWebTTYFileSystemURL(
      "https://shell.example/base?x=1",
      "/dir/file.txt",
      "/dav",
    ).toString(),
    "https://shell.example/base/dav/dir/file.txt?x=1",
  );
  assert.throws(
    () => resolveWebTTYFileSystemURL("rstrm://shell"),
    /native rstream dialer/,
  );
});

test("WebTTYFileSystem sends WebDAV requests and parses directory listings", async () => {
  const calls = [];
  const fs = new WebTTYFileSystem({
    authToken: "token",
    fetch: async (input, init) => {
      calls.push({
        authorization: init.headers.get("Authorization"),
        body: init.body,
        depth: init.headers.get("Depth"),
        method: init.method,
        url: input.toString(),
      });
      if (init.method === "PROPFIND") {
        return new Response(
          `<?xml version="1.0" encoding="utf-8"?>
          <D:multistatus xmlns:D="DAV:">
            <D:response>
              <D:href>/dav/</D:href>
              <D:propstat>
                <D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop>
                <D:status>HTTP/1.1 200 OK</D:status>
              </D:propstat>
            </D:response>
            <D:response>
              <D:href>/dav/file.txt</D:href>
              <D:propstat>
                <D:prop><D:getcontentlength>12</D:getcontentlength><D:getlastmodified>today</D:getlastmodified></D:prop>
                <D:status>HTTP/1.1 200 OK</D:status>
              </D:propstat>
            </D:response>
          </D:multistatus>`,
          { status: 207 },
        );
      }
      return new Response("ok", { status: 200 });
    },
    fsPath: "/dav",
    url: "https://shell.example",
  });
  assert.deepEqual(await fs.list("/"), [
    { kind: "directory", modified: undefined, path: "/", size: undefined },
    { kind: "file", modified: "today", path: "/file.txt", size: 12 },
  ]);
  await fs.writeText("/file.txt", "next");
  await fs.delete("/file.txt");
  assert.deepEqual(
    calls.map((call) => call.method),
    ["PROPFIND", "PUT", "DELETE"],
  );
  assert.equal(calls[0].authorization, "Bearer token");
  assert.equal(calls[0].depth, "1");
  assert.equal(calls[1].url, "https://shell.example/dav/file.txt");
});

test("WebTTYFileSystem exposes fs-style helpers and stream APIs", async () => {
  const calls = [];
  const fs = new WebTTYFileSystem({
    fetch: async (input, init) => {
      calls.push({
        body: init.body,
        destination: init.headers.get("Destination"),
        duplex: init.duplex,
        method: init.method,
        type: init.headers.get("Content-Type"),
        url: input.toString(),
      });
      if (init.method === "GET") return new Response("hello", { status: 200 });
      if (init.method === "PROPFIND") {
        return new Response(
          `<?xml version="1.0" encoding="utf-8"?>
          <D:multistatus xmlns:D="DAV:">
            <D:response>
              <D:href>/fs/dir</D:href>
              <D:propstat>
                <D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop>
                <D:status>HTTP/1.1 200 OK</D:status>
              </D:propstat>
            </D:response>
            <D:response>
              <D:href>/fs/dir/file.txt</D:href>
              <D:propstat>
                <D:prop><D:getcontentlength>5</D:getcontentlength></D:prop>
                <D:status>HTTP/1.1 200 OK</D:status>
              </D:propstat>
            </D:response>
          </D:multistatus>`,
          { status: 207 },
        );
      }
      if (init.method === "MKCOL") return new Response(null, { status: 201 });
      return new Response(null, { status: 204 });
    },
    url: "https://shell.example",
  });
  assert.equal(await fs.readFile("/hello.txt", "utf-8"), "hello");
  assert.equal(
    await readStreamText(await fs.readStream("/hello.txt")),
    "hello",
  );
  await fs.writeFile("/hello.txt", "updated");
  await fs.writeStream("/stream.txt", textStream("stream"), {
    contentType: "application/octet-stream",
  });
  await fs.mkdir("/dir", { recursive: true });
  assert.deepEqual(await fs.readdir("/dir"), ["file.txt"]);
  await fs.rename("/old.txt", "/new.txt");
  await fs.copyFile("/new.txt", "/copy.txt");
  await fs.rm("/new.txt", { force: true });
  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET", "GET", "PUT", "PUT", "MKCOL", "PROPFIND", "MOVE", "COPY", "DELETE"],
  );
  assert.equal(calls[3].type, "application/octet-stream");
  assert.equal(calls[3].duplex, "half");
  assert.equal(calls[6].destination, "https://shell.example/fs/new.txt");
  assert.equal(calls[7].destination, "https://shell.example/fs/copy.txt");
});

test("parseWebDAVMultiStatus ignores non-200 propstats", () => {
  assert.deepEqual(
    parseWebDAVMultiStatus(
      `
      <D:multistatus xmlns:D="DAV:">
        <D:response>
          <D:href>/dav/hidden.txt</D:href>
          <D:propstat>
            <D:prop><D:getcontentlength>9</D:getcontentlength></D:prop>
            <D:status>HTTP/1.1 404 Not Found</D:status>
          </D:propstat>
        </D:response>
      </D:multistatus>
    `,
      "/dav",
    ),
    [],
  );
});
