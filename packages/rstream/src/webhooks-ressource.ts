// See LICENSE file in the project root for license information.

import { webhookEventsSchema } from "./event";
import crypto from "crypto";
import type { WebhookEvent } from "./event";
import type { RstreamClient } from "./rstream";

export class RstreamWebhookRessource {
  private client: RstreamClient;

  constructor(client: RstreamClient) {
    this.client = client;
  }

  // Constructs and verifies the signature of an Event from the provided details.
  public async event(
    // Raw text body payload received from the webhook
    payload: string | Buffer,
    // The `rstream-signature` header received from the webhook
    header: string | Buffer | Array<string>,
    // Your webhook signing secret for this endpoint
    secret: string,
    // Seconds of tolerance on timestamps
    tolerance: number = 300, // Default 5 minutes
    // timestamp to use when checking signature validity. Defaults to Date.now().
    receivedAt: number = Date.now(),
  ): Promise<WebhookEvent> {
    // Ensure payload is a buffer
    const payloadBuffer = Buffer.isBuffer(payload)
      ? payload
      : Buffer.from(payload);
    // Extract the header value
    const signatureHeader = Array.isArray(header)
      ? header[0]
      : header.toString();
    if (!signatureHeader) {
      throw new Error("No signature header");
    }
    // Step 1: Extract the timestamp and signatures from the header
    const elements = signatureHeader
      .split(",")
      .map((element) => element.trim());
    let timestamp: string | undefined;
    const signatures: string[] = [];
    for (const element of elements) {
      if (element.startsWith("t=")) {
        timestamp = element.substring(2);
      } else if (element.startsWith("v1=")) {
        signatures.push(element.substring(3));
      }
    }
    if (!timestamp || signatures.length === 0) {
      throw new Error("Invalid signature header format");
    }
    // Step 2: Check timestamp freshness
    const timestampNum = parseInt(timestamp, 10);
    const now = Math.floor(receivedAt / 1000);
    if (Math.abs(now - timestampNum) > tolerance) {
      throw new Error(
        `Webhook signature timestamp outside tolerance: ${now}, ${timestampNum}`,
      );
    }
    // Step 3: Prepare the signed_payload string
    const signedPayload = `${timestamp}.${payloadBuffer.toString("utf8")}`;
    // Step 4: Determine the expected signature
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(signedPayload)
      .digest("hex");
    // Step 5: Compare the signatures using a constant-time string comparison
    let signatureMatched = false;
    for (const signature of signatures) {
      try {
        if (
          crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature),
          )
        ) {
          signatureMatched = true;
          break;
        }
      } catch (error) {
        console.log("Error comparing signatures:", error);
        continue;
      }
    }
    if (!signatureMatched) {
      throw new Error("Signature verification failed");
    }
    // Parse and validate the event data
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
