// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");

const { resolveClientOptions } = require("../dist/index.js");

const cert = "-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----\n";
const key = "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n";

function withEnv(t, values) {
  const previous = new Map();
  for (const key of Object.keys(values)) {
    previous.set(key, process.env[key]);
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function configFile(t, content) {
  const temp = mkdtempSync(join(tmpdir(), "rstream-runtime-test-"));
  t.after(() => rmSync(temp, { force: true, recursive: true }));
  const path = join(temp, "config.yaml");
  writeFileSync(path, content);
  return path;
}

function jwt(payload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `header.${encodedPayload}.sig`;
}

test("resolves explicit engine and explicit token without using stored credentials", async (t) => {
  const path = configFile(t, `
version: 1
defaults:
  context:
    name: prod
contexts:
  - name: prod
    engine: stored.example:443
    auth:
      token:
        storage:
          kind: inline
          value: stored-token
`);
  withEnv(t, {
    RSTREAM_AUTHENTICATION_TOKEN: undefined,
    RSTREAM_CONFIG: path,
    RSTREAM_CONTEXT: undefined,
    RSTREAM_ENGINE: undefined,
  });
  const resolved = await resolveClientOptions({
    engine: "override.example:443",
    token: "explicit-token",
  });
  assert.equal(resolved.engine, "override.example:443");
  assert.equal(resolved.token, "explicit-token");
});

test("noToken ignores stored config tokens for explicit engines", async (t) => {
  const path = configFile(t, `
version: 1
defaults:
  context:
    name: prod
contexts:
  - name: prod
    engine: stored.example:443
    auth:
      token:
        storage:
          kind: inline
          value: stored-token
`);
  withEnv(t, {
    RSTREAM_AUTHENTICATION_TOKEN: undefined,
    RSTREAM_CONFIG: path,
    RSTREAM_CONTEXT: undefined,
    RSTREAM_ENGINE: undefined,
  });
  const resolved = await resolveClientOptions({
    engine: "127.0.0.1:8443",
    noToken: true,
  });
  assert.equal(resolved.noToken, true);
  assert.equal(resolved.token, undefined);
});

test("rejects stored token when explicit engine changes the selected context", async (t) => {
  const path = configFile(t, `
version: 1
defaults:
  context:
    name: prod
contexts:
  - name: prod
    engine: stored.example:443
    auth:
      token:
        storage:
          kind: inline
          value: stored-token
`);
  withEnv(t, {
    RSTREAM_AUTHENTICATION_TOKEN: undefined,
    RSTREAM_CONFIG: path,
    RSTREAM_CONTEXT: undefined,
    RSTREAM_ENGINE: undefined,
  });
  await assert.rejects(
    () => resolveClientOptions({ engine: "override.example:443" }),
    /stored token with an explicit engine override/,
  );
});

test("rejects token and mTLS configured together", async (t) => {
  withEnv(t, {
    RSTREAM_CONFIG: join(process.cwd(), "test", "missing-config.yaml"),
  });
  await assert.rejects(
    () => resolveClientOptions({
      engine: "engine.example:443",
      tls: {
        cert: "cert",
        key: "key",
      },
      token: "token",
    }),
    /Token authentication and mTLS authentication cannot be used together/,
  );
});

test("explicit mTLS options suppress stored config tokens", async (t) => {
  const path = configFile(t, `
version: 1
defaults:
  context:
    name: prod
contexts:
  - name: prod
    engine: stored.example:443
    auth:
      token:
        storage:
          kind: inline
          value: stored-token
`);
  withEnv(t, {
    RSTREAM_AUTHENTICATION_TOKEN: undefined,
    RSTREAM_CONFIG: path,
    RSTREAM_CONTEXT: undefined,
    RSTREAM_ENGINE: undefined,
  });
  const resolved = await resolveClientOptions({
    requireToken: true,
    tls: { cert, key },
  });
  assert.equal(resolved.engine, "stored.example:443");
  assert.equal(resolved.token, undefined);
  assert.deepEqual(resolved.tls, { cert, key });
});

test("environment mTLS suppresses stored config tokens but rejects explicit environment tokens", async (t) => {
  const temp = mkdtempSync(join(tmpdir(), "rstream-runtime-mtls-test-"));
  t.after(() => rmSync(temp, { force: true, recursive: true }));
  const certPath = join(temp, "client.crt");
  const keyPath = join(temp, "client.key");
  writeFileSync(certPath, cert);
  writeFileSync(keyPath, key);
  const path = configFile(t, `
version: 1
defaults:
  context:
    name: prod
contexts:
  - name: prod
    engine: stored.example:443
    auth:
      token:
        storage:
          kind: inline
          value: stored-token
`);
  withEnv(t, {
    RSTREAM_AUTHENTICATION_TOKEN: undefined,
    RSTREAM_CONFIG: path,
    RSTREAM_CONTEXT: undefined,
    RSTREAM_ENGINE: undefined,
    RSTREAM_MTLS_CERT_FILE: certPath,
    RSTREAM_MTLS_KEY_FILE: keyPath,
  });
  const resolved = await resolveClientOptions({ requireToken: true });
  assert.equal(resolved.engine, "stored.example:443");
  assert.equal(resolved.token, undefined);
  assert.equal(resolved.tls.cert, cert);
  assert.equal(resolved.tls.key, key);

  withEnv(t, {
    RSTREAM_AUTHENTICATION_TOKEN: "env-token",
  });
  await assert.rejects(
    () => resolveClientOptions({ requireToken: true }),
    /Token authentication and mTLS authentication cannot be used together/,
  );
});

test("rejects stored mTLS credentials when explicit engine changes the selected context", async (t) => {
  const path = configFile(t, `
version: 1
defaults:
  context:
    name: prod
contexts:
  - name: prod
    engine: stored.example:443
    auth:
      mtls:
        certificate: |
          ${cert.replace(/\n/g, "\n          ").trim()}
        key: |
          ${key.replace(/\n/g, "\n          ").trim()}
`);
  withEnv(t, {
    RSTREAM_AUTHENTICATION_TOKEN: undefined,
    RSTREAM_CONFIG: path,
    RSTREAM_CONTEXT: undefined,
    RSTREAM_ENGINE: undefined,
  });
  await assert.rejects(
    () => resolveClientOptions({ engine: "override.example:443" }),
    /stored mTLS credentials with an explicit engine override/,
  );
});

test("rejects expired JWT-like tokens before dialing", async (t) => {
  withEnv(t, {
    RSTREAM_CONFIG: join(process.cwd(), "test", "missing-config.yaml"),
  });
  await assert.rejects(
    () => resolveClientOptions({
      engine: "engine.example:443",
      token: jwt({ exp: 1 }),
    }),
    /Token has expired/,
  );
});

test("uses enterprise-grade unsupported-feature wording", async (t) => {
  const path = configFile(t, `
version: 1
defaults:
  context:
    name: prod
contexts:
  - name: prod
    engine: engine.example:443
    auth:
      token:
        storage:
          kind: keychain
`);
  withEnv(t, {
    RSTREAM_CONFIG: path,
    RSTREAM_CONTEXT: undefined,
    RSTREAM_ENGINE: undefined,
  });
  await assert.rejects(
    () => resolveClientOptions({}),
    (error) => {
      assert.match(error.message, /not supported by @rstreamlabs\/runtime/);
      assert.doesNotMatch(error.message, /yet/);
      return true;
    },
  );
});
