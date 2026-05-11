// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const { RstreamWebhookResource } = require("../dist/index.js");

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
