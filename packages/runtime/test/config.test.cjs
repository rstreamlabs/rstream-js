// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");

const {
  resolveClientOptions,
  transportFromConfig,
} = require("../dist/index.js");

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
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `header.${encodedPayload}.sig`;
}

test("resolves explicit engine and explicit token without using stored credentials", async (t) => {
  const path = configFile(
    t,
    `
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
`,
  );
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
  const path = configFile(
    t,
    `
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
`,
  );
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
  const path = configFile(
    t,
    `
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
`,
  );
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
    () =>
      resolveClientOptions({
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
  const path = configFile(
    t,
    `
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
`,
  );
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
  const path = configFile(
    t,
    `
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
`,
  );
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
  const path = configFile(
    t,
    `
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
`,
  );
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
    () =>
      resolveClientOptions({
        engine: "engine.example:443",
        token: jwt({ exp: 1 }),
      }),
    /Token has expired/,
  );
});

test("uses enterprise-grade unsupported-feature wording", async (t) => {
  const path = configFile(
    t,
    `
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
`,
  );
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

test("resolves auto and tls tunnel transports to the TLS runtime", async (t) => {
  withEnv(t, {
    RSTREAM_CONFIG: join(process.cwd(), "test", "missing-config.yaml"),
    RSTREAM_QUIC_TRANSPORT: "1",
    RSTREAM_TUNNEL_TRANSPORT: "auto",
  });
  const resolved = await resolveClientOptions({
    engine: "engine.example:443",
    noToken: true,
  });
  assert.equal(resolved.tunnelTransport, "tls");
  assert.ok(resolved.transport);
  assert.ok(transportFromConfig({ mode: "tls" }));
});

test("rejects explicit and invalid QUIC tunnel transport modes", async (t) => {
  withEnv(t, {
    RSTREAM_CONFIG: join(process.cwd(), "test", "missing-config.yaml"),
    RSTREAM_QUIC_TRANSPORT: undefined,
    RSTREAM_TUNNEL_TRANSPORT: "quic",
  });
  await assert.rejects(
    () =>
      resolveClientOptions({
        engine: "engine.example:443",
        noToken: true,
      }),
    (error) => error.code === "ERR_RSTREAM_UNSUPPORTED_TRANSPORT",
  );
  assert.throws(
    () => transportFromConfig({ mode: "udp" }),
    (error) => error.code === "ERR_RSTREAM_INVALID_CONFIG",
  );
});

test("context transport selector overrides the environment selector", async (t) => {
  const path = configFile(
    t,
    `
version: 1
defaults:
  context:
    name: prod
environments:
  - apiUrl: https://rstream.io
    transport:
      mode: quic
contexts:
  - name: prod
    apiUrl: https://rstream.io
    engine: engine.example:443
    transport:
      useQuic: false
`,
  );
  withEnv(t, {
    RSTREAM_CONFIG: path,
    RSTREAM_QUIC_TRANSPORT: undefined,
    RSTREAM_TUNNEL_TRANSPORT: undefined,
  });
  const resolved = await resolveClientOptions({ noToken: true });
  assert.equal(resolved.tunnelTransport, "tls");
});

test("rejects unsupported SOCKS5 runtime proxy config", async (t) => {
  const path = configFile(
    t,
    `
version: 1
defaults:
  context:
    name: prod
contexts:
  - name: prod
    engine: engine.example:443
    transport:
      proxy:
        socks5: socks5://proxy.example:1080
`,
  );
  withEnv(t, {
    RSTREAM_AUTHENTICATION_TOKEN: undefined,
    RSTREAM_CONFIG: path,
    RSTREAM_CONTEXT: undefined,
    RSTREAM_ENGINE: undefined,
  });
  await assert.rejects(
    () => resolveClientOptions({ noToken: true }),
    /SOCKS5 proxy transport config is not supported by @rstreamlabs\/runtime/,
  );
});

test("parses runtime proxy fromEnvironment config", async () => {
  const transport = transportFromConfig({
    proxy: {
      fromEnvironment: true,
      headers: { "X-Trace": "trace-id" },
      password: "pass",
      tls: {
        caFile: "/etc/rstream/proxy-ca.pem",
        serverName: "proxy.example",
      },
      username: "user",
    },
  });
  assert.equal(transport.options.proxyFromEnvironment.username, "user");
  assert.equal(transport.options.proxyFromEnvironment.password, "pass");
  assert.equal(
    transport.options.proxyFromEnvironment.tls.caFile,
    "/etc/rstream/proxy-ca.pem",
  );
  assert.equal(
    transport.options.proxyFromEnvironment.tls.serverName,
    "proxy.example",
  );
  assert.equal(
    transport.options.proxyFromEnvironment.headers["X-Trace"],
    "trace-id",
  );
});

test("parses runtime HTTPS proxy TLS config", async () => {
  const transport = transportFromConfig({
    proxy: {
      http: "https://proxy.example:8443",
      tls: {
        caFile: "/etc/rstream/proxy-ca.pem",
        insecureSkipVerify: true,
        serverName: "proxy.example",
      },
    },
  });
  assert.equal(transport.options.proxy.url, "https://proxy.example:8443");
  assert.equal(transport.options.proxy.tls.caFile, "/etc/rstream/proxy-ca.pem");
  assert.equal(transport.options.proxy.tls.insecureSkipVerify, true);
  assert.equal(transport.options.proxy.tls.serverName, "proxy.example");
});

test("rejects standalone runtime proxy TLS config", async () => {
  assert.throws(
    () =>
      transportFromConfig({
        proxy: {
          tls: { caFile: "/etc/rstream/proxy-ca.pem" },
        },
      }),
    /Proxy TLS config requires proxy\.http or proxy\.fromEnvironment/,
  );
});

test("rejects unsupported SOCKS5 proxy from environment", async (t) => {
  withEnv(t, {
    ALL_PROXY: undefined,
    HTTP_PROXY: undefined,
    HTTPS_PROXY: "socks5://proxy.example:1080",
    NO_PROXY: undefined,
    all_proxy: undefined,
    http_proxy: undefined,
    https_proxy: undefined,
    no_proxy: undefined,
  });
  const transport = transportFromConfig({
    proxy: { fromEnvironment: true },
  });
  await assert.rejects(
    () => transport.dial({ address: "engine.example:443" }),
    /SOCKS5 proxy transport config from environment is not supported by @rstreamlabs\/runtime/,
  );
});

test("rejects invalid proxy URL from environment with runtime error", async (t) => {
  withEnv(t, {
    ALL_PROXY: undefined,
    HTTP_PROXY: undefined,
    HTTPS_PROXY: "://bad proxy",
    NO_PROXY: undefined,
    all_proxy: undefined,
    http_proxy: undefined,
    https_proxy: undefined,
    no_proxy: undefined,
  });
  const transport = transportFromConfig({
    proxy: { fromEnvironment: true },
  });
  await assert.rejects(
    () => transport.dial({ address: "engine.example:443" }),
    /Invalid proxy URL from environment/,
  );
});

test("rejects PKCS11 mTLS storage with explicit unsupported-feature wording", async (t) => {
  const path = configFile(
    t,
    `
version: 1
defaults:
  context:
    name: prod
contexts:
  - name: prod
    engine: engine.example:443
    auth:
      mtls:
        storage:
          kind: pkcs11
          module: /usr/lib/softhsm/libsofthsm2.so
          opensslProvider: pkcs11
          tokenLabel: "RSTREAM"
          keyLabel: "rstream-client"
          certificateFile: /etc/rstream/client.crt
          pinEnv: RSTREAM_PKCS11_PIN
`,
  );
  withEnv(t, {
    RSTREAM_AUTHENTICATION_TOKEN: undefined,
    RSTREAM_CONFIG: path,
    RSTREAM_CONTEXT: undefined,
    RSTREAM_ENGINE: undefined,
  });
  await assert.rejects(
    () => resolveClientOptions({}),
    (error) => {
      assert.match(error.message, /mTLS storage kind "pkcs11"/);
      assert.match(error.message, /not supported by @rstreamlabs\/runtime/);
      assert.doesNotMatch(error.message, /yet/);
      return true;
    },
  );
});

test("rejects macOS keychain mTLS storage with explicit unsupported-feature wording", async (t) => {
  const path = configFile(
    t,
    `
version: 1
defaults:
  context:
    name: prod
contexts:
  - name: prod
    engine: engine.example:443
    auth:
      mtls:
        storage:
          kind: keychain
          provider: macos
          certificateSHA256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
`,
  );
  withEnv(t, {
    RSTREAM_AUTHENTICATION_TOKEN: undefined,
    RSTREAM_CONFIG: path,
    RSTREAM_CONTEXT: undefined,
    RSTREAM_ENGINE: undefined,
  });
  await assert.rejects(
    () => resolveClientOptions({}),
    (error) => {
      assert.match(error.message, /mTLS storage kind "keychain"/);
      assert.match(error.message, /not supported by @rstreamlabs\/runtime/);
      assert.doesNotMatch(error.message, /yet/);
      return true;
    },
  );
});

test("rejects mTLS storage mixed with certificate aliases", async (t) => {
  const path = configFile(
    t,
    `
version: 1
defaults:
  context:
    name: prod
contexts:
  - name: prod
    engine: engine.example:443
    auth:
      mtls:
        certificateFile: /etc/rstream/client.crt
        storage:
          kind: pkcs11
          module: /usr/lib/softhsm/libsofthsm2.so
          tokenLabel: "RSTREAM"
          keyLabel: "rstream-client"
          certificateFile: /etc/rstream/client.crt
          pinEnv: RSTREAM_PKCS11_PIN
`,
  );
  withEnv(t, {
    RSTREAM_AUTHENTICATION_TOKEN: undefined,
    RSTREAM_CONFIG: path,
    RSTREAM_CONTEXT: undefined,
    RSTREAM_ENGINE: undefined,
  });
  await assert.rejects(
    () => resolveClientOptions({}),
    /mTLS storage cannot be mixed with certificate\/key aliases/,
  );
});
