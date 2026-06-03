// See LICENSE file in the project root for license information.

import { buildWebhookHeaders } from "@rstreamlabs/tunnels";
import { Watch } from "@rstreamlabs/tunnels";
import { webhookEventsSchema } from "@rstreamlabs/tunnels";
import { randomUUID } from "crypto";
import * as dotenv from "dotenv";
import type { WebhookEvent } from "@rstreamlabs/tunnels";
import type { WsEvent } from "@rstreamlabs/tunnels";

dotenv.config({ path: ".env.local" });

type Config = {
  authenticationToken: string;
  engine: string;
  webhookSecret: string;
  webhookURL: string;
};

async function main(): Promise<void> {
  const config = readConfig();
  const watch = new Watch(
    {
      auth: async () => config.authenticationToken,
      engine: config.engine,
      transport: "websocket",
    },
    {
      onConnect: () => console.log("Connected to the websocket server."),
      onEvent: (event) =>
        void forwardWebhookEvent(config, event).catch(logError),
      onClose: () => console.log("Connection closed."),
    },
  );
  await watch.connect();
}

function readConfig(): Config {
  return {
    authenticationToken: requiredEnv("RSTREAM_AUTHENTICATION_TOKEN"),
    engine: requiredEnv("RSTREAM_ENGINE"),
    webhookSecret: requiredEnv("WEBHOOK_SECRET"),
    webhookURL: requiredEnv("WEBHOOK_URL"),
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}.`);
  }
  return value;
}

async function forwardWebhookEvent(config: Config, event: WsEvent) {
  const parsed = webhookEventsSchema.safeParse(event);
  if (!parsed.success) {
    return;
  }
  const webhookEvent = eventWithID(parsed.data);
  const body = JSON.stringify(webhookEvent);
  const response = await fetch(config.webhookURL, {
    body,
    headers: {
      "content-type": "application/json",
      ...buildWebhookHeaders(body, webhookEvent, config.webhookSecret, {
        deliveryId: `cli_del_${randomUUID()}`,
        webhookId: "cli_we_local",
      }),
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `Failed to forward webhook event ${webhookEvent.id}: HTTP ${response.status}.`,
    );
  }
  console.log(`Webhook event forwarded: ${webhookEvent.id}.`);
}

function eventWithID(event: WebhookEvent): WebhookEvent & { id: string } {
  return { ...event, id: event.id ?? `evt_cli_${randomUUID()}` };
}

function logError(error: unknown): void {
  console.error(error);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
