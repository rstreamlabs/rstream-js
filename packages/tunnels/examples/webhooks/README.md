# `rstream-webhooks-example`

Example of forwarding deliverable `Watch` lifecycle events as signed webhook
requests with `@rstreamlabs/tunnels`.

The example filters out non-deliverable watch events, builds the canonical
webhook payload, signs the raw body, and sends the standard webhook headers to
`WEBHOOK_URL`. The receiving service must verify the request with the same
`WEBHOOK_SECRET`.
