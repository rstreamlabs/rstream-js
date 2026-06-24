// See LICENSE file in the project root for license information.

import { createWebTTYE2EClientPayloadCrypto } from "./e2e-crypto";
import { decodeWebTTYE2EKeyMaterial } from "./e2e-crypto";
import { webTTYE2EKeyID } from "./e2e-crypto";
import type { WebTTYE2EPayloadCrypto } from "./e2e-crypto";
import type { WebTTYE2ERecipient } from "./e2e-crypto";

const localKeyFileVersion = 1;
const localKeyFileCryptoSuite = "webtty-e2e-x25519-hpke-aes-256-gcm-v1";
const x25519PublicKeySize = 32;
const payloadKeyIDSize = 16;
const knownServerKeyEnv = "RSTREAM_WEBTTY_KNOWN_SERVER_KEY";
const knownServersFileEnv = "RSTREAM_WEBTTY_KNOWN_SERVERS_FILE";

export interface WebTTYLocalE2EEnv {
  [key: string]: string | undefined;
}

export interface WebTTYKnownServerKeyEntry {
  client_identity?: string;
  created_at?: string;
  key_id: string;
  name: string;
  public_key: string;
  signing_key_id?: string;
  signing_public_key?: string;
}

export interface WebTTYKnownServerKeysFile {
  crypto_suite: string;
  known_servers: WebTTYKnownServerKeyEntry[];
  version: number;
}

export interface WebTTYLocalTrustOptions {
  env?: WebTTYLocalE2EEnv;
  keyContext?: Uint8Array | string;
  required?: boolean;
  target?: string;
  hostKeyId?: string;
  knownServerKey?: string | readonly string[];
  knownServersFile?: string;
}

type NodePath = typeof import("node:path");
type NodeFS = typeof import("node:fs/promises");

export async function defaultWebTTYKnownServersPath(
  env?: WebTTYLocalE2EEnv,
): Promise<string> {
  const path = await nodePath();
  return path.join(
    await homeDir(env ?? defaultEnv()),
    ".rstream",
    "webtty",
    "known_servers.json",
  );
}

export async function parseWebTTYKnownServerKey(
  value: string,
): Promise<WebTTYE2ERecipient> {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new Error("known WebTTY server key is empty");
  }
  const parts = trimmed.split(":");
  if (parts.length !== 1 && parts.length !== 2 && parts.length !== 4) {
    throw new Error(
      "known WebTTY server key must be public_key, key_id:public_key, or endpoint identity",
    );
  }
  if (parts.length === 4) {
    validateSigningKeyMaterial(parts[2] ?? "", parts[3] ?? "");
  }
  if (parts.length === 1) {
    const publicKey = decodeFixedKeyMaterial(
      parts[0] ?? "",
      x25519PublicKeySize,
      "known WebTTY server public key",
    );
    return { keyId: await webTTYE2EKeyID(publicKey), publicKey };
  }
  const keyId = decodeFixedKeyMaterial(
    parts[0] ?? "",
    payloadKeyIDSize,
    "known WebTTY server key id",
  );
  const publicKey = decodeFixedKeyMaterial(
    parts[1] ?? "",
    x25519PublicKeySize,
    "known WebTTY server public key",
  );
  const expectedKeyId = await webTTYE2EKeyID(publicKey);
  if (!bytesEqual(keyId, expectedKeyId)) {
    throw new Error("known WebTTY server key id does not match public key");
  }
  return { keyId, publicKey };
}

export async function readWebTTYKnownServerKeysFile(
  filePath?: string,
  env?: WebTTYLocalE2EEnv,
): Promise<WebTTYKnownServerKeysFile> {
  const resolvedPath =
    cleanString(filePath) ?? (await defaultWebTTYKnownServersPath(env));
  const fs = await nodeFS();
  const data = await fs.readFile(resolvedPath, "utf8");
  return decodeWebTTYKnownServerKeysFile(data, resolvedPath);
}

export async function loadWebTTYKnownServerKeysFile(
  filePath?: string,
  env?: WebTTYLocalE2EEnv,
): Promise<WebTTYE2ERecipient[]> {
  const doc = await readWebTTYKnownServerKeysFile(filePath, env);
  return uniqueRecipients(
    await Promise.all(doc.known_servers.map(knownServerKeyFromEntry)),
  );
}

export async function createWebTTYE2EClientPayloadCryptoFromLocalTrust(
  options: WebTTYLocalTrustOptions = {},
): Promise<WebTTYE2EPayloadCrypto | undefined> {
  const env = options.env ?? defaultEnv();
  const directKeys = optionKeys(options.knownServerKey);
  const directRecipients = await parseWebTTYKnownServerKeys(directKeys);
  const envKey = cleanString(env[knownServerKeyEnv]);
  const envRecipients =
    envKey === undefined ? [] : [await parseWebTTYKnownServerKey(envKey)];
  const explicitFile =
    cleanString(options.knownServersFile) ??
    cleanString(env[knownServersFileEnv]);
  const fileRecipients =
    explicitFile === undefined
      ? []
      : await loadWebTTYKnownServerKeysFile(explicitFile, env);
  const explicitConfigured =
    directKeys.length > 0 || envKey !== undefined || explicitFile !== undefined;
  const defaultRecipients = explicitConfigured
    ? []
    : await loadDefaultKnownServerRecipients(env, {
        hostKeyId: options.hostKeyId,
        target: options.target,
      });
  const configured = explicitConfigured || defaultRecipients.length > 0;
  const recipients = uniqueRecipients([
    ...directRecipients,
    ...envRecipients,
    ...fileRecipients,
    ...defaultRecipients,
  ]);
  if (!configured && options.required !== true) {
    return undefined;
  }
  if (recipients.length === 0) {
    throw new Error(
      `E2E client mode requires knownServerKey, knownServersFile, ${knownServerKeyEnv}, ${knownServersFileEnv}, or ${await defaultWebTTYKnownServersPath(env)}`,
    );
  }
  return await createWebTTYE2EClientPayloadCrypto({
    keyContext: options.keyContext,
    recipients,
  });
}

async function parseWebTTYKnownServerKeys(
  values: readonly string[],
): Promise<WebTTYE2ERecipient[]> {
  return await Promise.all(values.map(parseWebTTYKnownServerKey));
}

async function loadDefaultKnownServerRecipients(
  env: WebTTYLocalE2EEnv,
  scope: { hostKeyId?: string; target?: string },
): Promise<WebTTYE2ERecipient[]> {
  const defaultPath = await defaultWebTTYKnownServersPath(env);
  const defaultDoc = await readOptionalKnownServersFile(defaultPath);
  const entries =
    defaultDoc === undefined
      ? []
      : filterKnownServerEntries(defaultDoc.known_servers, scope);
  return entries.length === 0
    ? []
    : uniqueRecipients(await Promise.all(entries.map(knownServerKeyFromEntry)));
}

function filterKnownServerEntries(
  entries: readonly WebTTYKnownServerKeyEntry[],
  scope: { hostKeyId?: string; target?: string },
): WebTTYKnownServerKeyEntry[] {
  const target = cleanString(scope.target);
  const hostKeyId = cleanString(scope.hostKeyId);
  if (target === undefined && hostKeyId === undefined) {
    return [...entries];
  }
  const targetMatches =
    target === undefined
      ? []
      : entries.filter((entry) => entry.name === target);
  if (hostKeyId === undefined) {
    return targetMatches;
  }
  if (targetMatches.length > 0) {
    return targetMatches.filter((entry) => entry.key_id === hostKeyId);
  }
  return entries.filter((entry) => entry.key_id === hostKeyId);
}

function decodeWebTTYKnownServerKeysFile(
  data: string,
  filePath: string,
): WebTTYKnownServerKeysFile {
  const parsed = parseJSONRecord(
    data,
    `decode known WebTTY server keys ${filePath}`,
  );
  assertKnownKeys(
    parsed,
    ["crypto_suite", "known_servers", "version"],
    `known WebTTY server keys ${filePath}`,
  );
  const version = parsed.version;
  if (version !== localKeyFileVersion) {
    throw new Error(
      `unsupported known WebTTY server keys version ${String(version)}`,
    );
  }
  const cryptoSuite = parsed.crypto_suite;
  if (cryptoSuite !== localKeyFileCryptoSuite) {
    throw new Error(
      `unsupported known WebTTY server keys crypto suite ${String(cryptoSuite)}`,
    );
  }
  const entries = parsed.known_servers;
  if (!Array.isArray(entries)) {
    throw new Error("known WebTTY server keys must include known_servers");
  }
  return {
    crypto_suite: cryptoSuite,
    known_servers: entries.map((entry, index) =>
      decodeKnownServerKeyEntry(entry, `known WebTTY server key ${index}`),
    ),
    version,
  };
}

function decodeKnownServerKeyEntry(
  value: unknown,
  label: string,
): WebTTYKnownServerKeyEntry {
  const entry = asRecord(value, label);
  assertKnownKeys(
    entry,
    [
      "client_identity",
      "created_at",
      "key_id",
      "name",
      "public_key",
      "signing_key_id",
      "signing_public_key",
    ],
    label,
  );
  const name = stringField(entry, "name", label).trim();
  if (name === "") {
    throw new Error(`${label} name is required`);
  }
  const signingKeyID = optionalStringField(entry, "signing_key_id", label);
  const signingPublicKey = optionalStringField(
    entry,
    "signing_public_key",
    label,
  );
  if ((signingKeyID === undefined) !== (signingPublicKey === undefined)) {
    throw new Error(
      `${label} signing_key_id and signing_public_key must be provided together`,
    );
  }
  if (signingKeyID !== undefined && signingPublicKey !== undefined) {
    validateSigningKeyMaterial(signingKeyID, signingPublicKey);
  }
  return {
    client_identity: optionalStringField(entry, "client_identity", label),
    created_at: optionalStringField(entry, "created_at", label),
    key_id: stringField(entry, "key_id", label),
    name,
    public_key: stringField(entry, "public_key", label),
    signing_key_id: signingKeyID,
    signing_public_key: signingPublicKey,
  };
}

async function knownServerKeyFromEntry(
  entry: WebTTYKnownServerKeyEntry,
): Promise<WebTTYE2ERecipient> {
  return await parseWebTTYKnownServerKey(`${entry.key_id}:${entry.public_key}`);
}

async function readOptionalKnownServersFile(
  filePath: string,
): Promise<WebTTYKnownServerKeysFile | undefined> {
  try {
    const fs = await nodeFS();
    const data = await fs.readFile(filePath, "utf8");
    return decodeWebTTYKnownServerKeysFile(data, filePath);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
}

function appendUniqueRecipient(
  recipients: WebTTYE2ERecipient[],
  next: WebTTYE2ERecipient,
): void {
  const nextKeyId = bytesFromKeyMaterial(next.keyId);
  const nextPublicKey = bytesFromKeyMaterial(next.publicKey);
  for (const existing of recipients) {
    const existingKeyId = bytesFromKeyMaterial(existing.keyId);
    if (!bytesEqual(existingKeyId, nextKeyId)) {
      continue;
    }
    if (!bytesEqual(bytesFromKeyMaterial(existing.publicKey), nextPublicKey)) {
      throw new Error("conflicting known WebTTY server public keys for key id");
    }
    return;
  }
  recipients.push({ keyId: nextKeyId, publicKey: nextPublicKey });
}

function uniqueRecipients(
  recipients: readonly WebTTYE2ERecipient[],
): WebTTYE2ERecipient[] {
  const out: WebTTYE2ERecipient[] = [];
  for (const recipient of recipients) {
    appendUniqueRecipient(out, recipient);
  }
  return out;
}

function optionKeys(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  return (Array.isArray(value) ? value : [value])
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function decodeFixedKeyMaterial(
  value: string,
  size: number,
  label: string,
): Uint8Array {
  const decoded = decodeWebTTYE2EKeyMaterial(value.trim());
  if (decoded.byteLength !== size) {
    throw new Error(`${label} must decode to ${size} bytes`);
  }
  return decoded;
}

function validateSigningKeyMaterial(keyID: string, publicKey: string): void {
  decodeFixedKeyMaterial(keyID, 32, "known WebTTY server signing key id");
  decodeWebTTYE2EKeyMaterial(publicKey.trim());
}

function bytesFromKeyMaterial(
  value: Uint8Array | string | undefined,
): Uint8Array {
  if (value === undefined) {
    return new Uint8Array();
  }
  return typeof value === "string"
    ? decodeWebTTYE2EKeyMaterial(value)
    : new Uint8Array(value);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  const diff = left.reduce(
    (current, value, index) => current | (value ^ (right[index] ?? 0)),
    0,
  );
  return diff === 0;
}

function parseJSONRecord(data: string, label: string): Record<string, unknown> {
  return asRecord(parseJSON(data, label), label);
}

function parseJSON(data: string, label: string): unknown {
  try {
    return JSON.parse(data);
  } catch (error) {
    throw new Error(`${label}: ${errorMessage(error)}`);
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return Object.fromEntries(Object.entries(value));
}

function assertKnownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      throw new Error(`${label} contains unknown field ${key}`);
    }
  }
}

function stringField(
  value: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const field = value[key];
  if (typeof field !== "string") {
    throw new Error(`${label} ${key} must be a string`);
  }
  return field;
}

function optionalStringField(
  value: Record<string, unknown>,
  key: string,
  label: string,
): string | undefined {
  const field = value[key];
  if (field === undefined) {
    return undefined;
  }
  if (typeof field !== "string") {
    throw new Error(`${label} ${key} must be a string`);
  }
  return field;
}

function cleanString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

function defaultEnv(): WebTTYLocalE2EEnv {
  const env = objectField(objectField(globalThis, "process"), "env");
  return env === undefined ? {} : stringRecord(env);
}

async function homeDir(env: WebTTYLocalE2EEnv): Promise<string> {
  const configured = cleanString(env.HOME) ?? cleanString(env.USERPROFILE);
  if (configured !== undefined) {
    return configured;
  }
  const os = await import("node:os");
  const resolved = os.homedir();
  if (resolved === "") {
    throw new Error("unable to resolve user home directory");
  }
  return resolved;
}

async function nodePath(): Promise<NodePath> {
  try {
    return await import("node:path");
  } catch {
    throw new Error("local WebTTY E2E trust helpers require a Node.js runtime");
  }
}

async function nodeFS(): Promise<NodeFS> {
  try {
    return await import("node:fs/promises");
  } catch {
    throw new Error("local WebTTY E2E trust helpers require a Node.js runtime");
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return objectField(error, "code") === code;
}

function objectField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(value))[key];
}

function stringRecord(value: unknown): WebTTYLocalE2EEnv {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, entry]) => typeof entry === "string" || entry === undefined,
    ),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
