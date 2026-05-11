// See LICENSE file in the project root for license information.

import { webhookEventsSchema } from "./event";
import crypto from "crypto";
import type { WebhookEvent } from "./event";

const SIGNATURE_HEX_BYTES = 32;
const signatureHexSchema = /^[0-9a-fA-F]{64}$/;
const timestampSchema = /^\d+$/;

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

export class RstreamWebhookResource {
  public async event(
    payload: string | Buffer,
    header: string | Buffer | Array<string>,
    secret: string,
    tolerance: number = 300,
    receivedAt: number = Date.now(),
  ): Promise<WebhookEvent> {
    const payloadBuffer = Buffer.isBuffer(payload)
      ? payload
      : Buffer.from(payload);
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
    const signedPayload = `${timestamp}.${payloadBuffer.toString("utf8")}`;
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(signedPayload)
      .digest();
    const signatureMatched = signatures.some((signature) =>
      signatureMatches(signature, expectedSignature),
    );
    if (!signatureMatched) {
      throw new Error("Signature verification failed");
    }
    try {
      return webhookEventsSchema.parse(
        JSON.parse(payloadBuffer.toString("utf8")),
      );
    } catch (error) {
      throw new Error(
        `Failed to parse webhook payload: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
}

export { RstreamWebhookResource as RstreamWebhookRessource };
