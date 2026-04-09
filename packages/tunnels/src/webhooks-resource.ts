// See LICENSE file in the project root for license information.

import { webhookEventsSchema } from "./event";
import crypto from "crypto";
import type { WebhookEvent } from "./event";

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
    const timestampNum = parseInt(timestamp, 10);
    const now = Math.floor(receivedAt / 1000);
    if (Math.abs(now - timestampNum) > tolerance) {
      throw new Error(
        `Webhook signature timestamp outside tolerance: ${now}, ${timestampNum}`,
      );
    }
    const signedPayload = `${timestamp}.${payloadBuffer.toString("utf8")}`;
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(signedPayload)
      .digest("hex");
    const signatureMatched = signatures.some((signature) => {
      try {
        return crypto.timingSafeEqual(
          Buffer.from(signature),
          Buffer.from(expectedSignature),
        );
      } catch {
        return false;
      }
    });
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
