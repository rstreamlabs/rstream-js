// See LICENSE file in the project root for license information.

import crypto from "crypto";
import { webhookEventsSchema } from "./event";
import type { WebhookEvent } from "./event";

export const WEBHOOK_SIGNATURE_HEADER = "rstream-signature";
export const WEBHOOK_EVENT_ID_HEADER = "rstream-event-id";
export const WEBHOOK_EVENT_TYPE_HEADER = "rstream-event-type";
export const WEBHOOK_ID_HEADER = "rstream-webhook-id";
export const WEBHOOK_DELIVERY_ID_HEADER = "rstream-delivery-id";

const SIGNATURE_HEX_BYTES = 32;
const webhookSecretBytes = 32;
const signatureHexSchema = /^[0-9a-fA-F]{64}$/;
const timestampSchema = /^\d+$/;

export type WebhookPayload = string | Buffer;

export type WebhookHeaders = Record<
  | typeof WEBHOOK_SIGNATURE_HEADER
  | typeof WEBHOOK_EVENT_ID_HEADER
  | typeof WEBHOOK_EVENT_TYPE_HEADER
  | typeof WEBHOOK_ID_HEADER
  | typeof WEBHOOK_DELIVERY_ID_HEADER,
  string
>;

export interface BuildWebhookHeadersOptions {
  deliveryId: string;
  timestamp?: Date | number;
  webhookId: string;
}

function payloadBuffer(payload: WebhookPayload): Buffer {
  return Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
}

function parseSignatureTimestamp(timestamp: string): number {
  if (!timestampSchema.test(timestamp)) {
    throw new Error("Invalid signature timestamp");
  }
  const parsed = Number(timestamp);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Invalid signature timestamp");
  }
  return parsed;
}

function normalizeTolerance(tolerance: number): number {
  if (
    !Number.isFinite(tolerance) ||
    !Number.isInteger(tolerance) ||
    tolerance < 0
  ) {
    throw new Error("Invalid signature tolerance");
  }
  return tolerance;
}

function normalizeTimestamp(timestamp?: Date | number): number {
  if (timestamp === undefined) {
    return Math.floor(Date.now() / 1000);
  }
  const seconds =
    timestamp instanceof Date ? timestamp.getTime() / 1000 : timestamp;
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error("Invalid webhook signature timestamp");
  }
  return Math.floor(seconds);
}

function signedPayload(timestamp: string, payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), payload]);
}

function readSignature(signature: string): Buffer | undefined {
  if (!signatureHexSchema.test(signature)) {
    return undefined;
  }
  const parsed = Buffer.from(signature, "hex");
  return parsed.length === SIGNATURE_HEX_BYTES ? parsed : undefined;
}

function signatureMatches(signature: string, expected: Buffer): boolean {
  const parsed = readSignature(signature);
  return parsed === undefined
    ? false
    : crypto.timingSafeEqual(parsed, expected);
}

function assertSecretConfigured(secret: string): void {
  if (secret.trim().length === 0) {
    throw new Error("Webhook signing secret is required");
  }
}

function assertNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

export function generateWebhookSigningSecret(): string {
  return `whsec_${crypto.randomBytes(webhookSecretBytes).toString("base64url")}`;
}

export function signWebhookPayload(
  payload: WebhookPayload,
  secret: string,
  timestamp?: Date | number,
): string {
  assertSecretConfigured(secret);
  const timestampSeconds = normalizeTimestamp(timestamp).toString();
  const signature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload(timestampSeconds, payloadBuffer(payload)))
    .digest("hex");
  return `t=${timestampSeconds},v1=${signature}`;
}

export function buildWebhookHeaders(
  payload: WebhookPayload,
  event: WebhookEvent,
  secret: string,
  options: BuildWebhookHeadersOptions,
): WebhookHeaders {
  const eventId = assertNonEmpty(event.id ?? "", "Webhook event id");
  const eventType = assertNonEmpty(event.type, "Webhook event type");
  const webhookId = assertNonEmpty(options.webhookId, "Webhook id");
  const deliveryId = assertNonEmpty(options.deliveryId, "Webhook delivery id");
  return {
    [WEBHOOK_SIGNATURE_HEADER]: signWebhookPayload(
      payload,
      secret,
      options.timestamp,
    ),
    [WEBHOOK_EVENT_ID_HEADER]: eventId,
    [WEBHOOK_EVENT_TYPE_HEADER]: eventType,
    [WEBHOOK_ID_HEADER]: webhookId,
    [WEBHOOK_DELIVERY_ID_HEADER]: deliveryId,
  };
}

export class RstreamWebhookResource {
  public async event(
    payload: WebhookPayload,
    header: string | Buffer | Array<string>,
    secret: string,
    tolerance: number = 300,
    receivedAt: number = Date.now(),
  ): Promise<WebhookEvent> {
    const rawPayload = payloadBuffer(payload);
    const signatureHeader = Array.isArray(header)
      ? header[0]
      : header.toString();
    if (!signatureHeader) {
      throw new Error("No signature header");
    }
    assertSecretConfigured(secret);
    const elements = signatureHeader
      .split(",")
      .map((element) => element.trim());
    const timestamp = elements
      .find((element) => element.startsWith("t="))
      ?.substring(2);
    const signatures = elements
      .filter((element) => element.startsWith("v1="))
      .map((element) => element.substring(3));
    if (!timestamp || signatures.length === 0) {
      throw new Error("Invalid signature header format");
    }
    const timestampNum = parseSignatureTimestamp(timestamp);
    const signatureTolerance = normalizeTolerance(tolerance);
    const now = Math.floor(receivedAt / 1000);
    if (Math.abs(now - timestampNum) > signatureTolerance) {
      throw new Error(
        `Webhook signature timestamp outside tolerance: ${now}, ${timestampNum}`,
      );
    }
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(signedPayload(timestamp, rawPayload))
      .digest();
    const signatureMatched = signatures.some((signature) =>
      signatureMatches(signature, expectedSignature),
    );
    if (!signatureMatched) {
      throw new Error("Signature verification failed");
    }
    try {
      return webhookEventsSchema.parse(JSON.parse(rawPayload.toString("utf8")));
    } catch (error) {
      throw new Error(
        `Failed to parse webhook payload: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  public generateSigningSecret(): string {
    return generateWebhookSigningSecret();
  }

  public sign(
    payload: WebhookPayload,
    secret: string,
    timestamp?: Date | number,
  ): string {
    return signWebhookPayload(payload, secret, timestamp);
  }

  public headers(
    payload: WebhookPayload,
    event: WebhookEvent,
    secret: string,
    options: BuildWebhookHeadersOptions,
  ): WebhookHeaders {
    return buildWebhookHeaders(payload, event, secret, options);
  }
}

export { RstreamWebhookResource as RstreamWebhookRessource };
