// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_EVENT_ID_HEADER,
  WEBHOOK_EVENT_TYPE_HEADER,
  WEBHOOK_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  RstreamWebhookResource,
  buildWebhookHeaders,
  generateWebhookSigningSecret,
  signWebhookPayload,
} = require("../dist/index.js");

const secret = "whsec_test";
const payload = JSON.stringify({
  type: "client.created",
  object: {
    id: "client-id",
    status: "online",
  },
});

function sign(timestamp, body = payload, signingSecret = secret) {
  const signature = crypto
    .createHmac("sha256", signingSecret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

test("webhook verification accepts a valid signed payload", async () => {
  const resource = new RstreamWebhookResource();
  const event = await resource.event(
    payload,
    sign("1700000000"),
    secret,
    300,
    1_700_000_000_000,
  );
  assert.equal(event.type, "client.created");
  assert.equal(event.object.id, "client-id");
});

test("webhook signing secret generation returns a webhook secret", () => {
  assert.match(generateWebhookSigningSecret(), /^whsec_[A-Za-z0-9_-]{43}$/);
  const resource = new RstreamWebhookResource();
  assert.match(resource.generateSigningSecret(), /^whsec_[A-Za-z0-9_-]{43}$/);
});

test("webhook signing matches the engine signature format", () => {
  const signature = signWebhookPayload(
    `{"id":"evt_1"}`,
    "whsec_test",
    1_700_000_000,
  );
  assert.equal(
    signature,
    "t=1700000000,v1=c89214b5b5da833daed6f0b8c5bb6bd58cea9022bd80ccc78230f3942d632925",
  );
});

test("webhook header builder returns signed delivery headers", () => {
  const event = {
    id: "evt_1",
    type: "client.created",
    object: {
      id: "client-id",
      status: "online",
    },
  };
  const headers = buildWebhookHeaders(JSON.stringify(event), event, secret, {
    deliveryId: "del_1",
    timestamp: 1_700_000_000,
    webhookId: "we_1",
  });
  assert.equal(headers[WEBHOOK_EVENT_ID_HEADER], "evt_1");
  assert.equal(headers[WEBHOOK_EVENT_TYPE_HEADER], "client.created");
  assert.equal(headers[WEBHOOK_ID_HEADER], "we_1");
  assert.equal(headers[WEBHOOK_DELIVERY_ID_HEADER], "del_1");
  assert.match(headers[WEBHOOK_SIGNATURE_HEADER], /^t=1700000000,v1=/);
});

test("webhook header builder rejects incomplete metadata", () => {
  assert.throws(
    () =>
      buildWebhookHeaders(
        payload,
        { type: "client.created", object: { id: "client-id" } },
        secret,
        { deliveryId: "del_1", webhookId: "we_1" },
      ),
    /event id/,
  );
  assert.throws(
    () =>
      buildWebhookHeaders(
        payload,
        { id: "evt_1", type: "", object: { id: "client-id" } },
        secret,
        { deliveryId: "del_1", webhookId: "we_1" },
      ),
    /event type/,
  );
  assert.throws(
    () =>
      buildWebhookHeaders(
        payload,
        { id: "evt_1", type: "client.created", object: { id: "client-id" } },
        secret,
        { deliveryId: "", webhookId: "we_1" },
      ),
    /delivery id/,
  );
});

test("webhook verification accepts one matching signature among rotations", async () => {
  const resource = new RstreamWebhookResource();
  const header = `${sign("1700000000", payload, "old_secret")},v1=${
    sign("1700000000").split("v1=")[1]
  }`;
  const event = await resource.event(
    Buffer.from(payload),
    Buffer.from(header),
    secret,
    300,
    1_700_000_000_000,
  );
  assert.equal(event.type, "client.created");
});

test("webhook verification rejects malformed timestamps even when signed", async () => {
  const resource = new RstreamWebhookResource();
  await assert.rejects(
    () =>
      resource.event(
        payload,
        sign("1700000000abc"),
        secret,
        300,
        1_700_000_000_000,
      ),
    /Invalid signature timestamp/,
  );
});

test("webhook verification rejects unsafe tolerance values", async () => {
  const resource = new RstreamWebhookResource();
  await assert.rejects(
    () =>
      resource.event(
        payload,
        sign("1700000000"),
        secret,
        Number.NaN,
        1_700_000_000_000,
      ),
    /Invalid signature tolerance/,
  );
});

test("webhook verification rejects empty signing secrets", async () => {
  const resource = new RstreamWebhookResource();
  await assert.rejects(
    () =>
      resource.event(
        payload,
        sign("1700000000", payload, ""),
        "",
        300,
        1_700_000_000_000,
      ),
    /signing secret/,
  );
});

test("webhook verification rejects stale or malformed signatures", async () => {
  const resource = new RstreamWebhookResource();
  await assert.rejects(
    () =>
      resource.event(
        payload,
        sign("1699990000"),
        secret,
        300,
        1_700_000_000_000,
      ),
    /outside tolerance/,
  );
  await assert.rejects(
    () =>
      resource.event(
        payload,
        "t=1700000000,v1=not-hex",
        secret,
        300,
        1_700_000_000_000,
      ),
    /Signature verification failed/,
  );
});
