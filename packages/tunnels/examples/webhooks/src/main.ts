// See LICENSE file in the project root for license information.

import { Watch } from "@rstreamlabs/tunnels";
import * as dotenv from "dotenv";
import crypto from "crypto";

dotenv.config({ path: ".env.local" });

async function main(): Promise<void> {
  const config = {
    RSTREAM_AUTHENTICATION_TOKEN: process.env.RSTREAM_AUTHENTICATION_TOKEN, // The token used to authenticate with the rstream API
    RSTREAM_ENGINE: process.env.RSTREAM_ENGINE, // The engine to connect to
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET, // The secret used for signing the event payload
    WEBHOOK_URL: process.env.WEBHOOK_URL, // The target webhook URL to forward events
  };
  if (
    !config.RSTREAM_ENGINE ||
    !config.RSTREAM_AUTHENTICATION_TOKEN ||
    !config.WEBHOOK_SECRET ||
    !config.WEBHOOK_URL
  ) {
    throw new Error("Missing required environment variables.");
  }
  const watch = new Watch(
    {
      auth: async () => config.RSTREAM_AUTHENTICATION_TOKEN!,
      engine: config.RSTREAM_ENGINE!,
      transport: "websocket",
    },
    {
      onConnect: () => {
        console.log("Connected to the websocket server.");
      },
      onEvent: async (evt) => {
        try {
          const payload = JSON.stringify(evt);
          const timestamp = Math.floor(Date.now() / 1000).toString();
          const signature = crypto
            .createHmac("sha256", config.WEBHOOK_SECRET!)
            .update(`${timestamp}.${payload}`)
            .digest("hex");
          const res = await fetch(config.WEBHOOK_URL!, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "rstream-signature": `t=${timestamp},v1=${signature}`,
            },
            body: payload,
          });
          if (!res.ok) {
            const errText = await res.text();
            console.error(
              `Failed to forward event. Status=${res.status}, error=${errText}`,
            );
          } else {
            console.log(`Event forwarded (status ${res.status}).`);
          }
        } catch (err) {
          console.error("Error forwarding event:", err);
        }
      },
      onClose: () => {
        console.log("Connection closed.");
      },
    },
  );
  await watch.connect();
}

main().catch((error) => {
  console.error("Fatal error in main:", error);
  process.exit(1);
});
