// See LICENSE file in the project root for license information.

import crypto from "crypto";
import jwt from "jsonwebtoken";
import type { RstreamAppTokenClaims } from "./auth";

export function signAppToken(
  claims: RstreamAppTokenClaims,
  clientSecret: string,
): string {
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(clientSecret, "hex"),
    format: "der",
    type: "pkcs8",
  });
  return jwt.sign(claims, privateKey, {
    algorithm: "ES512",
  });
}
