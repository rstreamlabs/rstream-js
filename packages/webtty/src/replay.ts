// See LICENSE file in the project root for license information.

import { createWebTTYE2EServerPayloadCrypto } from "./e2e-crypto";
import { decodeWebTTYE2EKeyMaterial } from "./e2e-crypto";
import type { WebTTYE2EIdentity } from "./e2e-crypto";
import type { WebTTYE2EPayloadCrypto } from "./e2e-crypto";
import type { WebTTYEncryptedPayload } from "./webtty";
import type { WebTTYKeyEnvelope } from "./webtty";
import type { WebTTYKeyEnvelopeSuite } from "./webtty";
import type { WebTTYPayloadCipherSuite } from "./webtty";
import type { WebTTYPayloadCrypto } from "./webtty";
import type { WebTTYPayloadCryptoMetadata } from "./webtty";
import type { WebTTYSessionKeyGrant } from "./webtty";

type MaybePromise<T> = T | Promise<T>;

export type WebTTYRecordedStreamType = "stdin" | "stdout" | "stderr";

export interface WebTTYRecordedCryptoMetadata {
  key_context?: unknown;
  key_context_raw?: string;
  key_envelope_suite?: WebTTYKeyEnvelopeSuite;
  key_envelopes?: unknown;
  nonce?: string;
  payload_key_id?: string;
  payload_suite?: WebTTYPayloadCipherSuite;
}

export interface WebTTYRecordedSessionEvent {
  created_at?: string | null;
  crypto?: WebTTYRecordedCryptoMetadata | null;
  direction?: string | null;
  metadata?: unknown;
  payload_ciphertext?: string | Uint8Array | number[] | null;
  payload_length?: number | null;
  payload_plaintext?: string | Uint8Array | number[] | null;
  seq?: string | number | null;
  stream_type?: WebTTYRecordedStreamType | string | null;
  type?: string | null;
}

export interface WebTTYRecordedKeyGrantDecryptMaterial {
  crypto?: WebTTYRecordedCryptoMetadata | null;
  recipient_id?: string | null;
  recipient_kind?: string | null;
  wrapped_key?: string | Uint8Array | number[] | null;
}

export interface WebTTYReplayChunk {
  data: Uint8Array;
  stream: WebTTYRecordedStreamType;
}

export interface WebTTYRecordedTextLogOptions {
  includeActiveAlternateScreen?: boolean;
  includeStderr?: boolean;
  includeStdin?: boolean;
  includeStdout?: boolean;
  includeTerminalModeMarkers?: boolean;
  includeTimestamps?: boolean;
  includeResizeMarkers?: boolean;
  stripAnsi?: boolean;
}

export interface WebTTYRecordedTextLog {
  detectedAlternateScreen: boolean;
  text: string;
  warnings: string[];
}

interface ReplayPayloadCrypto extends WebTTYPayloadCrypto {
  decryptStdin?: (payload: WebTTYEncryptedPayload) => MaybePromise<Uint8Array>;
}

type ResolvedTextLogOptions = Required<WebTTYRecordedTextLogOptions>;

type TerminalTextSegment =
  | { kind: "enter-alternate-screen" }
  | { kind: "leave-alternate-screen" }
  | { kind: "text"; value: string };

export function webTTYRecordedEventEncryptedPayload(
  event: WebTTYRecordedSessionEvent,
): WebTTYEncryptedPayload | null {
  if (
    event.type !== undefined &&
    event.type !== null &&
    event.type !== "data"
  ) {
    return null;
  }
  const ciphertext = bytesFromRecordedValue(event.payload_ciphertext);
  if (ciphertext.byteLength === 0) {
    return null;
  }
  return {
    ciphertext,
    payloadCrypto: payloadCryptoMetadataFromRecordedMetadata(event.crypto),
    plaintextLength: event.payload_length ?? 0,
  };
}

export async function decryptWebTTYRecordedEvent(
  event: WebTTYRecordedSessionEvent,
  payloadCrypto: WebTTYPayloadCrypto,
): Promise<WebTTYReplayChunk | null> {
  const encrypted = webTTYRecordedEventEncryptedPayload(event);
  if (encrypted === null) {
    return null;
  }
  const stream = recordedStreamType(event.stream_type);
  const decrypt = decryptHook(payloadCrypto, stream);
  return { data: await decrypt(encrypted), stream };
}

export async function decryptWebTTYRecordedTextLog(
  events: readonly WebTTYRecordedSessionEvent[],
  payloadCrypto: WebTTYPayloadCrypto,
  options: WebTTYRecordedTextLogOptions = {},
): Promise<WebTTYRecordedTextLog> {
  const chunks: WebTTYReplayChunk[] = [];
  for (const event of events) {
    const plaintext = recordedEventPlaintextChunk(event);
    if (plaintext !== null) {
      chunks.push(plaintext);
      continue;
    }
    const decrypted = await decryptWebTTYRecordedEvent(event, payloadCrypto);
    if (decrypted !== null) {
      chunks.push(decrypted);
    }
  }
  return renderWebTTYRecordedTextLog(events, chunks, options);
}

export async function createWebTTYE2EReplayPayloadCryptoFromKeyGrant(
  grant: WebTTYRecordedKeyGrantDecryptMaterial,
  identity: WebTTYE2EIdentity,
): Promise<WebTTYE2EPayloadCrypto> {
  const sessionKeyGrant = sessionKeyGrantFromRecordedMetadata(grant.crypto);
  if (sessionKeyGrant === undefined) {
    throw new Error("WebTTY key grant decrypt material is missing crypto");
  }
  const wrappedKey = bytesFromRecordedValue(grant.wrapped_key);
  if (wrappedKey.byteLength > 0) {
    attachWrappedKeyToSessionKeyGrant(sessionKeyGrant, wrappedKey, identity);
  }
  return await createWebTTYE2EServerPayloadCrypto(sessionKeyGrant, identity);
}

export function renderWebTTYRecordedTextLog(
  events: readonly WebTTYRecordedSessionEvent[],
  chunks: readonly WebTTYReplayChunk[],
  options: WebTTYRecordedTextLogOptions = {},
): WebTTYRecordedTextLog {
  const resolved = resolveTextLogOptions(options);
  const warnings = new Set<string>();
  const main = new TerminalTextBuffer();
  let alternate: TerminalTextBuffer | undefined;
  let detectedAlternateScreen = false;
  let chunkIndex = 0;
  for (const event of events) {
    if (event.type === "resize") {
      if (resolved.includeResizeMarkers) {
        main.write(formatMarker(event, terminalResizeMarker(event), resolved));
      }
      continue;
    }
    if (
      event.type !== undefined &&
      event.type !== null &&
      event.type !== "data"
    ) {
      continue;
    }
    if (!recordedEventHasPayload(event)) {
      continue;
    }
    const chunk = chunks[chunkIndex];
    chunkIndex += 1;
    if (chunk === undefined || !includeTextLogStream(chunk.stream, resolved)) {
      continue;
    }
    const rawText = new TextDecoder().decode(chunk.data);
    for (const segment of terminalTextSegments(rawText)) {
      if (segment.kind === "enter-alternate-screen") {
        detectedAlternateScreen = true;
        warnings.add("alternate-screen");
        alternate = new TerminalTextBuffer();
        if (resolved.includeTerminalModeMarkers) {
          main.write(
            formatMarker(event, "terminal alternate screen entered", resolved),
          );
        }
        continue;
      }
      if (segment.kind === "leave-alternate-screen") {
        detectedAlternateScreen = true;
        warnings.add("alternate-screen");
        alternate = undefined;
        if (resolved.includeTerminalModeMarkers) {
          main.write(
            formatMarker(event, "terminal alternate screen left", resolved),
          );
        }
        continue;
      }
      const text = segment.value;
      if (text.length === 0) {
        continue;
      }
      const target = alternate ?? main;
      if (resolved.includeTimestamps) {
        target.write(formatDataPrefix(event, chunk.stream, resolved));
      }
      target.write(text);
    }
  }
  let text = main.toString();
  if (alternate !== undefined && resolved.includeActiveAlternateScreen) {
    if (resolved.includeTerminalModeMarkers) {
      text += formatMarker(
        undefined,
        "terminal alternate screen active",
        resolved,
      );
    }
    text += alternate.toString();
  }
  if (resolved.stripAnsi) {
    text = stripANSIEscapeSequences(text);
  }
  return {
    detectedAlternateScreen,
    text,
    warnings: [...warnings],
  };
}

function decryptHook(
  payloadCrypto: WebTTYPayloadCrypto,
  stream: WebTTYRecordedStreamType,
): (payload: WebTTYEncryptedPayload) => MaybePromise<Uint8Array> {
  if (stream === "stdout" && payloadCrypto.decryptStdout !== undefined) {
    return payloadCrypto.decryptStdout;
  }
  if (stream === "stderr" && payloadCrypto.decryptStderr !== undefined) {
    return payloadCrypto.decryptStderr;
  }
  const replayCrypto = payloadCrypto as ReplayPayloadCrypto;
  if (stream === "stdin" && replayCrypto.decryptStdin !== undefined) {
    return replayCrypto.decryptStdin;
  }
  throw new Error(`Missing WebTTY replay decrypt hook for ${stream}.`);
}

function recordedStreamType(
  value: WebTTYRecordedSessionEvent["stream_type"],
): WebTTYRecordedStreamType {
  if (value === "stdin" || value === "stdout" || value === "stderr") {
    return value;
  }
  throw new Error(`Unsupported WebTTY replay stream ${String(value)}.`);
}

function recordedEventPlaintextChunk(
  event: WebTTYRecordedSessionEvent,
): WebTTYReplayChunk | null {
  if (
    event.type !== undefined &&
    event.type !== null &&
    event.type !== "data"
  ) {
    return null;
  }
  const plaintext = bytesFromRecordedValue(event.payload_plaintext);
  if (plaintext.byteLength === 0) {
    return null;
  }
  return { data: plaintext, stream: recordedStreamType(event.stream_type) };
}

function recordedEventHasPayload(event: WebTTYRecordedSessionEvent): boolean {
  if (bytesFromRecordedValue(event.payload_plaintext).byteLength > 0) {
    return true;
  }
  return bytesFromRecordedValue(event.payload_ciphertext).byteLength > 0;
}

function resolveTextLogOptions(
  options: WebTTYRecordedTextLogOptions,
): ResolvedTextLogOptions {
  return {
    includeActiveAlternateScreen: options.includeActiveAlternateScreen ?? true,
    includeStderr: options.includeStderr ?? true,
    includeStdin: options.includeStdin ?? false,
    includeStdout: options.includeStdout ?? true,
    includeTerminalModeMarkers: options.includeTerminalModeMarkers ?? true,
    includeTimestamps: options.includeTimestamps ?? false,
    includeResizeMarkers: options.includeResizeMarkers ?? false,
    stripAnsi: options.stripAnsi ?? true,
  };
}

function includeTextLogStream(
  stream: WebTTYRecordedStreamType,
  options: ResolvedTextLogOptions,
): boolean {
  if (stream === "stdin") return options.includeStdin;
  if (stream === "stdout") return options.includeStdout;
  if (stream === "stderr") return options.includeStderr;
  return false;
}

function terminalTextSegments(value: string): TerminalTextSegment[] {
  const out: TerminalTextSegment[] = [];
  // eslint-disable-next-line no-control-regex
  const pattern = /\x1b\[\?([0-9;:]+)([hl])/g;
  let offset = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    const modes = match[1] ?? "";
    if (!containsAlternateScreenMode(modes)) {
      continue;
    }
    if (match.index > offset) {
      out.push({ kind: "text", value: value.slice(offset, match.index) });
    }
    out.push({
      kind:
        match[2] === "h" ? "enter-alternate-screen" : "leave-alternate-screen",
    });
    offset = pattern.lastIndex;
  }
  if (offset < value.length) {
    out.push({ kind: "text", value: value.slice(offset) });
  }
  return out.length === 0 ? [{ kind: "text", value }] : out;
}

function containsAlternateScreenMode(value: string): boolean {
  return value
    .split(/[;:]/)
    .some((mode) => mode === "47" || mode === "1047" || mode === "1049");
}

function formatMarker(
  event: WebTTYRecordedSessionEvent | undefined,
  message: string,
  options: ResolvedTextLogOptions,
): string {
  const timestamp =
    options.includeTimestamps && event?.created_at
      ? `${event.created_at} `
      : "";
  return `${timestamp}[webtty] ${message}\n`;
}

function formatDataPrefix(
  event: WebTTYRecordedSessionEvent,
  stream: WebTTYRecordedStreamType,
  options: ResolvedTextLogOptions,
): string {
  if (!options.includeTimestamps) {
    return "";
  }
  const timestamp = event.created_at ? `${event.created_at} ` : "";
  return `${timestamp}[${stream}] `;
}

function terminalResizeMarker(event: WebTTYRecordedSessionEvent): string {
  const metadata = metadataRecord(event.metadata);
  const terminalSize = objectRecord(metadata.terminal_size);
  const row = numberValue(terminalSize.row);
  const col = numberValue(terminalSize.col);
  if (row !== undefined && col !== undefined) {
    return `terminal resized to ${col}x${row}`;
  }
  return "terminal resized";
}

function metadataRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string" && value.trim() !== "") {
    try {
      return objectRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return objectRecord(value);
}

function sessionKeyGrantFromRecordedMetadata(
  metadata: WebTTYRecordedSessionEvent["crypto"],
): WebTTYSessionKeyGrant | undefined {
  if (metadata === null || metadata === undefined) {
    return undefined;
  }
  return {
    keyContext: keyContextFromRecordedMetadata(metadata),
    keyEnvelopes: keyEnvelopesFromRecordedValue(metadata.key_envelopes),
    keyEnvelopeSuite: metadata.key_envelope_suite,
    payloadKeyId: bytesFromBase64URL(metadata.payload_key_id),
    payloadSuite: metadata.payload_suite,
  };
}

function payloadCryptoMetadataFromRecordedMetadata(
  metadata: WebTTYRecordedSessionEvent["crypto"],
): WebTTYPayloadCryptoMetadata | undefined {
  if (metadata === null || metadata === undefined) {
    return undefined;
  }
  return {
    aadContext: keyContextFromRecordedMetadata(metadata),
    nonce: bytesFromBase64URL(metadata.nonce),
    payloadKeyId: bytesFromBase64URL(metadata.payload_key_id),
    payloadSuite: metadata.payload_suite,
  };
}

function attachWrappedKeyToSessionKeyGrant(
  sessionKeyGrant: WebTTYSessionKeyGrant,
  wrappedKey: Uint8Array,
  identity: WebTTYE2EIdentity,
): void {
  const keyEnvelopes = sessionKeyGrant.keyEnvelopes ?? [];
  if (keyEnvelopes.length === 0) {
    throw new Error("WebTTY key grant decrypt material has no key envelope");
  }
  const identityKeyId = bytesFromKeyMaterial(identity.keyId);
  for (const envelope of keyEnvelopes) {
    if (
      bytesEqual(envelope.recipientKeyId, identityKeyId) ||
      keyEnvelopes.length === 1
    ) {
      if (
        envelope.wrappedKey === undefined ||
        envelope.wrappedKey.byteLength === 0
      ) {
        envelope.wrappedKey = new Uint8Array(wrappedKey);
      }
      return;
    }
  }
}

function keyEnvelopesFromRecordedValue(value: unknown): WebTTYKeyEnvelope[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => {
    const item = objectRecord(entry);
    return {
      encapsulatedKey: bytesFromBase64URL(stringValue(item.encapsulated_key)),
      recipientKeyId: bytesFromBase64URL(stringValue(item.recipient_key_id)),
      wrappedKey: bytesFromBase64URL(stringValue(item.wrapped_key)),
    };
  });
}

function keyContextFromRecordedMetadata(
  metadata: WebTTYRecordedCryptoMetadata,
): Uint8Array {
  if (
    typeof metadata.key_context_raw === "string" &&
    metadata.key_context_raw !== ""
  ) {
    return bytesFromBase64(metadata.key_context_raw);
  }
  return keyContextFromRecordedValue(metadata.key_context);
}

function keyContextFromRecordedValue(value: unknown): Uint8Array {
  if (value === null || value === undefined) {
    return new Uint8Array();
  }
  if (typeof value === "object") {
    const item = objectRecord(value);
    if (item.encoding === "base64" && typeof item.value === "string") {
      return bytesFromBase64(item.value);
    }
  }
  return new TextEncoder().encode(JSON.stringify(value));
}

class TerminalTextBuffer {
  private col = 0;
  private lines: string[] = [""];
  private row = 0;
  private savedCol = 0;
  private savedRow = 0;

  write(value: string): void {
    for (let i = 0; i < value.length; i += 1) {
      const char = value[i];
      if (char === "\x1b") {
        i = this.consumeEscape(value, i);
        continue;
      }
      if (char === "\r") {
        this.col = 0;
        continue;
      }
      if (char === "\n") {
        this.row += 1;
        this.col = 0;
        this.ensureRow();
        continue;
      }
      if (char === "\b") {
        this.col = Math.max(0, this.col - 1);
        continue;
      }
      if (char === "\t") {
        const spaces = 8 - (this.col % 8);
        for (let j = 0; j < spaces; j += 1) {
          this.writePrintable(" ");
        }
        continue;
      }
      if (char !== undefined && char >= " ") {
        this.writePrintable(char);
      }
    }
  }

  toString(): string {
    return this.lines.join("\n");
  }

  private consumeEscape(value: string, offset: number): number {
    const next = value[offset + 1];
    if (next === "[") {
      const end = this.findCSIEnd(value, offset + 2);
      if (end === -1) {
        return value.length - 1;
      }
      this.applyCSI(value.slice(offset + 2, end), value[end] ?? "");
      return end;
    }
    if (next === "]") {
      return this.findOSCEnd(value, offset + 2);
    }
    return Math.min(value.length - 1, offset + 1);
  }

  private findCSIEnd(value: string, offset: number): number {
    for (let i = offset; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      if (code >= 0x40 && code <= 0x7e) {
        return i;
      }
    }
    return -1;
  }

  private findOSCEnd(value: string, offset: number): number {
    for (let i = offset; i < value.length; i += 1) {
      if (value[i] === "\x07") {
        return i;
      }
      if (value[i] === "\x1b" && value[i + 1] === "\\") {
        return i + 1;
      }
    }
    return value.length - 1;
  }

  private applyCSI(rawParams: string, final: string): void {
    if (rawParams.startsWith("?")) {
      return;
    }
    const params = parseCSIParams(rawParams);
    const first = params[0] ?? 0;
    switch (final) {
      case "A":
        this.row = Math.max(0, this.row - Math.max(first, 1));
        return;
      case "B":
        this.row += Math.max(first, 1);
        this.ensureRow();
        return;
      case "C":
        this.col += Math.max(first, 1);
        return;
      case "D":
        this.col = Math.max(0, this.col - Math.max(first, 1));
        return;
      case "G":
        this.col = Math.max(0, Math.max(first, 1) - 1);
        return;
      case "H":
      case "f":
        this.row = Math.max(0, Math.max(params[0] ?? 1, 1) - 1);
        this.col = Math.max(0, Math.max(params[1] ?? 1, 1) - 1);
        this.ensureRow();
        return;
      case "J":
        this.eraseDisplay(first);
        return;
      case "K":
        this.eraseLine(first);
        return;
      case "s":
        this.savedRow = this.row;
        this.savedCol = this.col;
        return;
      case "u":
        this.row = this.savedRow;
        this.col = this.savedCol;
        this.ensureRow();
        return;
    }
  }

  private eraseDisplay(mode: number): void {
    if (mode === 2 || mode === 3) {
      this.lines = [""];
      this.row = 0;
      this.col = 0;
      return;
    }
    if (mode === 0) {
      this.lines[this.row] = (this.lines[this.row] ?? "").slice(0, this.col);
      this.lines = this.lines.slice(0, this.row + 1);
      return;
    }
    if (mode === 1) {
      for (let i = 0; i < this.row; i += 1) {
        this.lines[i] = "";
      }
      this.lines[this.row] =
        " ".repeat(this.col) + (this.lines[this.row] ?? "").slice(this.col);
    }
  }

  private eraseLine(mode: number): void {
    const line = this.lines[this.row] ?? "";
    if (mode === 2) {
      this.lines[this.row] = "";
      this.col = 0;
      return;
    }
    if (mode === 1) {
      this.lines[this.row] = " ".repeat(this.col) + line.slice(this.col);
      return;
    }
    this.lines[this.row] = line.slice(0, this.col);
  }

  private ensureRow(): void {
    while (this.lines.length <= this.row) {
      this.lines.push("");
    }
  }

  private writePrintable(char: string): void {
    this.ensureRow();
    const line = this.lines[this.row] ?? "";
    const padded = line.length < this.col ? line.padEnd(this.col, " ") : line;
    this.lines[this.row] =
      padded.slice(0, this.col) + char + padded.slice(this.col + char.length);
    this.col += char.length;
  }
}

function parseCSIParams(value: string): number[] {
  if (value.trim() === "") {
    return [];
  }
  return value.split(/[;:]/).map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
}

function stripANSIEscapeSequences(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b[ -/]*[@-~]/g, "")
  );
}

function bytesFromRecordedValue(
  value: string | Uint8Array | number[] | null | undefined,
): Uint8Array {
  if (value === null || value === undefined) {
    return new Uint8Array();
  }
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value)) {
    return new Uint8Array(value);
  }
  return bytesFromBase64(value);
}

function bytesFromBase64URL(value: string | undefined): Uint8Array | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  return bytesFromBase64(value);
}

function bytesFromBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(value)) {
    throw new Error("invalid base64 value");
  }
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  const standard = bytesToBase64(out);
  const rawStandard = standard.replace(/=+$/, "");
  const url = bytesToBase64URL(out);
  if (value !== standard && value !== rawStandard && value !== url) {
    throw new Error("invalid base64 value");
  }
  return out;
}

function bytesToBase64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}

function bytesToBase64URL(value: Uint8Array): string {
  const binary = String.fromCharCode(...value);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function bytesFromKeyMaterial(value: Uint8Array | string): Uint8Array {
  return typeof value === "string"
    ? decodeWebTTYE2EKeyMaterial(value)
    : new Uint8Array(value);
}

function bytesEqual(
  left: Uint8Array | undefined,
  right: Uint8Array | undefined,
): boolean {
  if (left === undefined || right === undefined) return false;
  if (left.byteLength !== right.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < left.byteLength; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
