# Forward signed lifecycle events to a webhook receiver

This sample watches live Engine events and sends signed HTTP requests to a
test receiver. Use it to verify the same signing format used by project
webhooks.

[Build the checkout](../../../../docs/000-building-from-source.md) so this
sample can load its local SDK dependency. Start a test receiver that verifies
the [signature on the raw HTTP body](https://rstream.io/docs/integrations/webhooks#signatures).
Use a test project and a [short-lived watch token](../../../../docs/browser/000-watch.md)
with `tunnels.resources.read-only` and `scopes.tunnels.list: true`. Use
`scopes.clients.list: true` if you want client lifecycle events as well. Keep
all returned fields in the allowed categories so the sample can validate
the complete event body.

From this directory, copy the example environment file.

```sh
cp .env.local.example .env.local
```

Edit `.env.local` and set each value.

| Variable                       | Value                                                                      |
| ------------------------------ | -------------------------------------------------------------------------- |
| `RSTREAM_ENGINE`               | Engine authority for the project, including a nondefault port if needed.   |
| `RSTREAM_AUTHENTICATION_TOKEN` | Short-lived `auth` or `app` token scoped to the project's inventory watch. |
| `WEBHOOK_SECRET`               | Dedicated test secret also configured in the receiver.                     |
| `WEBHOOK_URL`                  | Test receiver URL, such as `http://127.0.0.1:3000/api/rstream/webhook`.    |

Install the sample dependencies and start the watcher.

```sh
npm install
npm start
```

After the WebSocket connects, start and stop a disposable tunnel in the same
project. The sample prints `Webhook event forwarded:` for each delivery the
receiver accepts. Check for verified creation and deletion events in the test
receiver. Stop the watcher with Ctrl+C and remove the local credential file.
