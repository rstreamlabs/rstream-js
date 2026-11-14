// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const test = require("node:test");
const { RstreamTunnelsClient, eventSchema, webTTYContextMetadataSchema, webTTYParticipantSchema } = require("../dist/index.js");

const participant = {
  id: "participant-1", session_id: "session-1", role: "spectator",
  attached_at: "2026-11-14T00:00:00.000Z", controller: false,
};

for (const owner of [
  { user_id: "user-1" },
  { credential_id: "credential-service", owner_workspace_id: "workspace-1", auth_expires_at: "2026-11-14T01:00:00.000Z" },
]) {
  test(`WebTTY participant API and events retain ${owner.user_id ? "personal" : "workspace"} attribution`, async (t) => {
    const data = { ...participant, ...owner };
    assert.deepEqual(webTTYParticipantSchema.parse(data), data);
    const event = eventSchema.parse({ type: "webtty.participant.joined", object: data });
    assert.deepEqual(event.object, data);
    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });
    global.fetch = async () => new Response(JSON.stringify([data]), { headers: { "Content-Type": "application/json" } });
    const client = new RstreamTunnelsClient({ credentials: { token: "token" }, engine: "project.example.test:443" });
    assert.deepEqual(await client.webtty.listParticipants("session-1"), [data]);
    if (!owner.user_id) assert.equal("user_id" in event.object, false);
  });
}

test("WebTTY session context retains the verified workspace source", () => {
  const context = { credential_id: "credential-service", owner_workspace_id: "workspace-1" };
  assert.deepEqual(webTTYContextMetadataSchema.parse(context), context);
});
