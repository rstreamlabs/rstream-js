// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const test = require("node:test");

const { Watch } = require("../dist/index.js");

class FakeEventSource {
  constructor(url) {
    this.closed = false;
    this.closeCount = 0;
    this.onerror = null;
    this.onmessage = null;
    this.onopen = null;
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
    this.closeCount += 1;
  }

  emitOpen() {
    this.onopen?.({});
  }

  emitMessage(data) {
    this.onmessage?.({ data });
  }

  emitError() {
    this.onerror?.({});
  }
}

FakeEventSource.instances = [];

class FakeWebSocket extends FakeEventSource {
  constructor(url) {
    super(url);
    this.onclose = null;
    FakeWebSocket.instances.push(this);
  }

  emitClose() {
    this.onclose?.({});
  }
}

FakeWebSocket.instances = [];

function installTransports() {
  const previous = {
    EventSource: global.EventSource,
    WebSocket: global.WebSocket,
  };
  FakeEventSource.instances = [];
  FakeWebSocket.instances = [];
  global.EventSource = FakeEventSource;
  global.WebSocket = FakeWebSocket;
  return () => {
    global.EventSource = previous.EventSource;
    global.WebSocket = previous.WebSocket;
  };
}

function clientCreatedEvent() {
  return {
    type: "client.created",
    object: {
      id: "client-id",
      status: "online",
    },
  };
}

function shortAuthToken(payload = {}) {
  const iat = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({
      exp: iat + 60,
      iat,
      permissions: null,
      resources: {
        tunnels: {
          projects: ["project-id"],
          scopes: {
            tunnels: {
              list: true,
            },
          },
        },
      },
      type: "auth",
      userId: "user-id",
      ...payload,
    }),
  ).toString("base64url");
  return `${header}.${body}.sig`;
}

test("watch opens an SSE connection and processes validated events", async () => {
  const restore = installTransports();
  const events = [];
  let closed = 0;
  let connected = 0;
  let tokenCalls = 0;
  const token = shortAuthToken();
  try {
    const watch = new Watch(
      {
        auth: async () => {
          tokenCalls += 1;
          return token;
        },
        engine: "engine.example.test:8443",
      },
      {
        onClose: () => {
          closed += 1;
        },
        onConnect: () => {
          connected += 1;
        },
        onEvent: (event) => {
          events.push(event);
        },
      },
    );
    await watch.connect();
    const source = FakeEventSource.instances[0];
    const url = new URL(source.url);
    assert.equal(url.origin, "https://engine.example.test:8443");
    assert.equal(url.port, "8443");
    assert.equal(url.pathname, "/api/sse");
    assert.equal(url.searchParams.get("rstream.token"), token);
    source.emitOpen();
    source.emitMessage(JSON.stringify(clientCreatedEvent()));
    assert.equal(tokenCalls, 1);
    assert.equal(connected, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].object.id, "client-id");
    watch.disconnect();
    watch.disconnect();
    assert.equal(source.closed, true);
    assert.equal(source.closeCount, 1);
    assert.equal(closed, 1);
  } finally {
    restore();
  }
});

test("watch closes and suppresses malformed server events", async () => {
  const restore = installTransports();
  const events = [];
  let closed = 0;
  try {
    const watch = new Watch(
      {
        auth: shortAuthToken(),
        engine: "engine.example.test:8443",
      },
      {
        onClose: () => {
          closed += 1;
        },
        onEvent: (event) => {
          events.push(event);
        },
      },
    );
    await watch.connect();
    const source = FakeEventSource.instances[0];
    source.emitMessage("{not-json");
    source.emitMessage(JSON.stringify(clientCreatedEvent()));
    assert.equal(source.closed, true);
    assert.equal(source.closeCount, 1);
    assert.equal(closed, 1);
    assert.deepEqual(events, []);
  } finally {
    restore();
  }
});

test("watch opens websocket URLs with the websocket scheme", async () => {
  const restore = installTransports();
  let closed = 0;
  const token = shortAuthToken();
  try {
    const watch = new Watch(
      {
        auth: token,
        engine: "engine.example.test:8443",
        transport: "websocket",
      },
      {
        onClose: () => {
          closed += 1;
        },
      },
    );
    await watch.connect();
    const socket = FakeWebSocket.instances[0];
    const url = new URL(socket.url);
    assert.equal(url.protocol, "wss:");
    assert.equal(url.origin, "wss://engine.example.test:8443");
    assert.equal(url.port, "8443");
    assert.equal(url.pathname, "/api/websocket");
    assert.equal(url.searchParams.get("rstream.token"), token);
    socket.emitClose();
    assert.equal(socket.closed, true);
    assert.equal(closed, 1);
  } finally {
    restore();
  }
});

test("watch accepts read-only engine permissions with list-only resources", async () => {
  const restore = installTransports();
  const token = shortAuthToken({
    permissions: ["tunnels.resources.read-only"],
  });
  try {
    const watch = new Watch(
      {
        auth: token,
        engine: "engine.example.test:8443",
      },
      {},
    );
    await watch.connect();
    assert.equal(FakeEventSource.instances.length, 1);
  } finally {
    restore();
  }
});

test("watch accepts delegated auth tokens with source credential metadata", async () => {
  const restore = installTransports();
  const token = shortAuthToken({
    permissions: ["tunnels.resources.read-only"],
    sourceCredentialId: "credential-id",
    sourceCredentialUpdatedAt: "2030-01-01T00:00:00.000Z",
  });
  try {
    const watch = new Watch(
      {
        auth: token,
        engine: "engine.example.test:8443",
      },
      {},
    );
    await watch.connect();
    assert.equal(FakeEventSource.instances.length, 1);
  } finally {
    restore();
  }
});

test("watch accepts AND resources that combine project restrictions and list scopes", async () => {
  const restore = installTransports();
  const token = shortAuthToken({
    resources: {
      tunnels: {
        AND: [
          {
            projects: ["project-id"],
          },
          {
            scopes: {
              tunnels: {
                list: true,
              },
            },
          },
        ],
      },
    },
  });
  try {
    const watch = new Watch(
      {
        auth: token,
        engine: "engine.example.test:8443",
      },
      {},
    );
    await watch.connect();
    assert.equal(FakeEventSource.instances.length, 1);
  } finally {
    restore();
  }
});

test("watch rejects OR resources when any branch is broader than list access", async () => {
  const restore = installTransports();
  const token = shortAuthToken({
    resources: {
      tunnels: {
        OR: [
          {
            projects: ["project-id"],
            scopes: {
              tunnels: {
                list: true,
              },
            },
          },
          {
            projects: ["project-id"],
            scopes: {
              tunnels: {
                connect: true,
              },
            },
          },
        ],
      },
    },
  });
  try {
    const watch = new Watch(
      {
        auth: token,
        engine: "engine.example.test:8443",
      },
      {},
    );
    await assert.rejects(() => watch.connect(), /fine-grained token/);
    assert.equal(FakeEventSource.instances.length, 0);
  } finally {
    restore();
  }
});

test("watch rejects unsupported runtime transports before opening sockets", async () => {
  const restore = installTransports();
  try {
    const watch = new Watch(
      {
        auth: shortAuthToken(),
        engine: "engine.example.test:8443",
        transport: "long-poll",
      },
      {},
    );
    await assert.rejects(() => watch.connect(), /Unsupported transport/);
    assert.equal(FakeEventSource.instances.length, 0);
    assert.equal(FakeWebSocket.instances.length, 0);
  } finally {
    restore();
  }
});

test("watch rejects long-lived tokens and remains retryable after setup failure", async () => {
  const restore = installTransports();
  const now = Math.floor(Date.now() / 1000);
  let token = shortAuthToken({ exp: now + 3601, iat: now });
  const watch = new Watch(
    {
      auth: () => token,
      engine: "engine.example.test:8443",
    },
    {},
  );
  try {
    await assert.rejects(() => watch.connect(), /bounded lifetime/);
    assert.equal(FakeEventSource.instances.length, 0);
    token = shortAuthToken();
    await watch.connect();
    assert.equal(FakeEventSource.instances.length, 1);
  } finally {
    restore();
  }
});

test("watch rejects future-issued URL tokens", async () => {
  const restore = installTransports();
  const now = Math.floor(Date.now() / 1000);
  try {
    const watch = new Watch(
      {
        auth: shortAuthToken({ exp: now + 7260, iat: now + 7200 }),
        engine: "engine.example.test:8443",
      },
      {},
    );
    await assert.rejects(() => watch.connect(), /bounded lifetime/);
    assert.equal(FakeEventSource.instances.length, 0);
  } finally {
    restore();
  }
});

test("watch rejects broad URL tokens", async () => {
  const restore = installTransports();
  try {
    const broadToken = shortAuthToken({
      permissions: ["tunnels.tunnels.create-delete"],
      resources: undefined,
    });
    const connectToken = shortAuthToken({
      resources: {
        tunnels: {
          projects: ["project-id"],
          scopes: {
            tunnels: {
              connect: true,
              list: true,
            },
          },
        },
      },
    });
    const watch = new Watch(
      {
        auth: broadToken,
        engine: "engine.example.test:8443",
      },
      {},
    );
    await assert.rejects(() => watch.connect(), /fine-grained token/);
    assert.equal(FakeEventSource.instances.length, 0);
    const connectWatch = new Watch(
      {
        auth: connectToken,
        engine: "engine.example.test:8443",
      },
      {},
    );
    await assert.rejects(() => connectWatch.connect(), /fine-grained token/);
    assert.equal(FakeEventSource.instances.length, 0);
  } finally {
    restore();
  }
});
