// See LICENSE file in the project root for license information.

import crypto from "crypto";
import jwt from "jsonwebtoken";
import type { CreateShortTermTokenParams } from "./auth";
import type { CreateShortTermTokenResponse } from "./auth";
import type { RstreamAuthJwtPayload } from "./auth";
import type { RstreamClient } from "./rstream";

export class RstreamAuthRessource {
  private client: RstreamClient;

  constructor(client: RstreamClient) {
    this.client = client;
  }

  async createShortTermToken(
    params?: CreateShortTermTokenParams,
    options?: { credentials?: { clientId: string; clientSecret: string } },
  ): Promise<CreateShortTermTokenResponse> {
    const credentials = options?.credentials || this.client.credentials;
    if (!credentials || !("clientId" in credentials)) {
      throw new Error(
        "Application credentials (client id, client secret) are required to create a short term token.",
      );
    }
    const now = Math.floor(Date.now() / 1000);
    const exp = now + (params?.expires_in ?? 60); // Default 60s TTL
    const payload: RstreamAuthJwtPayload = {
      iat: now, // Issued at
      exp: exp, // Expiration time
      type: "app",
      clientId: credentials.clientId,
      metadata: {
        engine: this.client.engine,
        permissions: params?.permissions,
      },
    };
    const pk = crypto.createPrivateKey({
      key: Buffer.from(credentials.clientSecret, "hex"),
      format: "der",
      type: "pkcs8",
    });
    const token = jwt.sign(payload, pk, {
      algorithm: "ES512",
    });
    const result: CreateShortTermTokenResponse = {
      token,
    };
    return result;
  }
}
