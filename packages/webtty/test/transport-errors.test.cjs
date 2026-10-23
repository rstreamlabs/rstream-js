// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const test = require("node:test");
const { WebTTY } = require("../dist/index.js");

async function failConnection(phase, error, url) {
  const previous = global.WebTransport;
  const ended = Promise.withResolvers();
  const errors = [];
  global.WebTransport = class {
    constructor() {
      if (phase === "constructor") throw error;
      this.ready = phase === "ready" ? Promise.reject(error) : Promise.resolve();
      this.closed = phase === "closed" ? Promise.reject(error) : new Promise(() => {});
    }
    createBidirectionalStream() {
      if (phase === "stream") return Promise.reject(error);
      return Promise.resolve({
        readable: new ReadableStream({ start(controller) { if (phase === "read") controller.error(error); } }),
        writable: new WritableStream({ write() { if (phase === "write") throw error; } }),
      });
    }
    close() {}
  };
  const client = new WebTTY(
    {
      url,
      transport: phase === "websocket-constructor" ? "websocket" : "webtransport",
      webSocketFactory: () => { throw error; },
      sendHeartbeat: false,
    },
    undefined,
    { onError(message) { errors.push(message); ended.resolve(); } },
  );
  const timer = setTimeout(() => ended.reject(new Error("missing connection error")), 1000);
  try {
    client.connect();
    await ended.promise;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(errors.length, 1);
    return errors[0];
  } finally {
    clearTimeout(timer);
    client.disconnect();
    global.WebTransport = previous;
  }
}

for (const phase of ["constructor", "ready", "stream", "closed", "read", "write", "websocket-constructor"]) {
  test(`WebTTY removes connection credentials from ${phase} errors`, async () => {
    const secret = "fixture-access/credential+with spaces&symbols";
    const second = "fixture-second-credential";
    const url = new URL("https://shell.example.test/session");
    url.searchParams.append("rstream.token", secret);
    url.searchParams.append("rstream.token", second);
    const form = new URLSearchParams({ value: secret }).toString().slice(6);
    const encoded = encodeURIComponent(secret);
    const lowerEscapes = encoded.replace(/%[\da-f]{2}/gi, (value) => value.toLowerCase());
    const doubleEncoded = encodeURIComponent(encoded);
    const message = `fixture reason: ${url}; raw=${secret}; encoded=${encoded}; form=${form}; lower=${lowerEscapes}; double=${doubleEncoded}; duplicate=${second}`;
    const diagnostic = await failConnection(phase, new Error(message), url);
    assert.match(diagnostic, /fixture reason/);
    for (const value of [secret, second, encoded, form, lowerEscapes, doubleEncoded]) assert.equal(diagnostic.includes(value), false);
    assert.match(diagnostic, /redacted/i);
  });
}

test("WebTransport empty errors give a useful fallback without inventing a cause", async () => {
  const diagnostic = await failConnection("closed", new Error(""), "https://shell.example.test/session");
  assert.match(diagnostic, /no .*reason|no .*details|no .*diagnostic/i);
  assert.doesNotMatch(diagnostic, /CSP|Content Security Policy/i);
});

test("invalid endpoint configuration throws without retaining the input URL", () => {
  for (const transport of [undefined, "websocket", "webtransport"]) {
    assert.throws(() => {
      new WebTTY({ url: "https://invalid host/?token=fixture-secret", transport }).connect();
    }, (error) => {
      assert.match(error.message, /Invalid WebTTY endpoint URL/);
      assert.equal(error.input, undefined);
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(error.message, /fixture-secret/);
      return true;
    });
  }
});

test("WebTransport security errors explain the browser policy boundary", async () => {
  const diagnostic = await failConnection("ready", new DOMException("", "SecurityError"), "https://shell.example.test/session");
  assert.match(diagnostic, /browser.*security policy/i);
  assert.match(diagnostic, /connect-src/i);
});

test("WebTTY diagnostics do not expose URL userinfo or fragments", async () => {
  const url = new URL("https://fixture-user:fixture-password@shell.example.test/session#fixture-fragment-secret");
  const diagnostic = await failConnection("constructor", new Error(`fixture reason: ${url}`), url);
  for (const value of ["fixture-user", "fixture-password", "fixture-fragment-secret"]) assert.equal(diagnostic.includes(value), false);
});
