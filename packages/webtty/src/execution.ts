// See LICENSE file in the project root for license information.

import { WebTTY } from "./webtty";
import type { WebTTYClientConfig } from "./webtty";
import type { WebTTYExecutionConfig } from "./webtty";

export type WebTTYURLProvider =
  string | URL | (() => Promise<string | URL> | string | URL);

export type WebTTYCommandOutput = "both" | "stderr" | "stdout";

export type WebTTYCommandStream = "stderr" | "stdout";

export interface WebTTYRemoteExecutorConfig {
  execPath?: string;
  heartbeatIntervalMs?: number;
  sendHeartbeat?: boolean;
  url: WebTTYURLProvider;
}

export interface WebTTYCommandReadOptions {
  signal?: AbortSignal;
}

export interface ExecuteWebTTYCommandOptions extends WebTTYExecutionConfig {
  execPath?: string;
  input?: string | Uint8Array;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface WebTTYRunCommandOptions extends Omit<
  ExecuteWebTTYCommandOptions,
  "cmdArgs" | "envVars" | "input" | "workdir"
> {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: string | Uint8Array;
}

export interface WebTTYCommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
  success: boolean;
}

export interface WebTTYCommandStatus {
  exitCode: number;
  success: boolean;
}

export interface WebTTYCommandLog {
  data: string;
  stream: WebTTYCommandStream;
}

export interface WebTTYCommandLogBytes {
  data: Uint8Array;
  stream: WebTTYCommandStream;
}

interface StreamSubscriber<T> {
  close(): void;
  enqueue(value: T): void;
  error(error: Error): void;
}

class Deferred<T> {
  private onReject: (error: Error) => void = () => {};
  private onResolve: (value: T) => void = () => {};
  public readonly promise: Promise<T>;
  public constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.onResolve = resolve;
      this.onReject = reject;
    });
    this.promise.catch(() => undefined);
  }
  public reject(error: Error): void {
    this.onReject(error);
  }
  public resolve(value: T): void {
    this.onResolve(value);
  }
}

class ReplayStreamSubscriber<T> implements StreamSubscriber<T> {
  private controller: ReadableStreamDefaultController<T> | null = null;
  public bind(controller: ReadableStreamDefaultController<T>): void {
    this.controller = controller;
  }
  public close(): void {
    this.controller?.close();
  }
  public enqueue(value: T): void {
    this.controller?.enqueue(value);
  }
  public error(error: Error): void {
    this.controller?.error(error);
  }
}

class ReplayStreamChannel<T> {
  private readonly completion = new Deferred<void>();
  private closed = false;
  private failure: Error | null = null;
  private subscribers: StreamSubscriber<T>[] = [];
  private values: T[] = [];
  public append(value: T): void {
    if (this.closed || this.failure) return;
    this.values = [...this.values, value];
    this.subscribers.forEach((subscriber) => subscriber.enqueue(value));
  }
  public close(): void {
    if (this.closed || this.failure) return;
    this.closed = true;
    this.subscribers.forEach((subscriber) => subscriber.close());
    this.subscribers = [];
    this.completion.resolve();
  }
  public error(error: Error): void {
    if (this.closed || this.failure) return;
    this.failure = error;
    this.subscribers.forEach((subscriber) => subscriber.error(error));
    this.subscribers = [];
    this.completion.reject(error);
  }
  public stream(): ReadableStream<T> {
    const subscriber = new ReplayStreamSubscriber<T>();
    return new ReadableStream<T>({
      cancel: () => this.unsubscribe(subscriber),
      start: (controller) => this.subscribe(subscriber, controller),
    });
  }
  public async valuesAfterClose(
    options: WebTTYCommandReadOptions = {},
  ): Promise<readonly T[]> {
    await withSignal(this.completion.promise, options.signal);
    return this.values;
  }
  private subscribe(
    subscriber: ReplayStreamSubscriber<T>,
    controller: ReadableStreamDefaultController<T>,
  ): void {
    subscriber.bind(controller);
    this.values.forEach((value) => controller.enqueue(value));
    if (this.failure) {
      controller.error(this.failure);
      return;
    }
    if (this.closed) {
      controller.close();
      return;
    }
    this.subscribers = [...this.subscribers, subscriber];
  }
  private unsubscribe(subscriber: StreamSubscriber<T>): void {
    this.subscribers = this.subscribers.filter((entry) => entry !== subscriber);
  }
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
  );
  chunks.reduce((offset, chunk) => {
    output.set(chunk, offset);
    return offset + chunk.byteLength;
  }, 0);
  return output;
}

function encodeInput(input: string | Uint8Array): Uint8Array {
  return typeof input === "string" ? new TextEncoder().encode(input) : input;
}

function resolveInteractive(options: ExecuteWebTTYCommandOptions): boolean {
  if (options.input !== undefined && options.interactive === false) {
    throw new Error("Command input requires an interactive WebTTY session.");
  }
  return options.input === undefined ? (options.interactive ?? false) : true;
}

function cleanTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeEndpointPath(path: string): string {
  const trimmed = path.trim();
  const absolute = trimmed === "" || trimmed === "." ? "/" : trimmed;
  return new URL(
    absolute.startsWith("/") ? absolute : `/${absolute}`,
    "http://rstream.local",
  ).pathname;
}

function executionPath(pathname: string, execPath: string | undefined): string {
  const endpoint = normalizeEndpointPath(execPath ?? "/");
  const basePath = cleanTrailingSlashes(pathname);
  if (endpoint === "/") return basePath === "" ? "/" : basePath;
  if (basePath === "") return endpoint;
  if (basePath === "/") return endpoint;
  if (basePath === endpoint || basePath.startsWith(`${endpoint}/`))
    return basePath;
  return `${basePath}${endpoint}`;
}

export function resolveWebTTYExecutionURL(
  input: string | URL,
  execPath = "/",
): URL {
  const url = new URL(input.toString());
  if (url.protocol === "rstrm:") {
    throw new Error(
      "rstrm:// WebTTY execution URLs require the native rstream dialer.",
    );
  }
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(
      `Unsupported WebTTY execution URL scheme "${url.protocol}".`,
    );
  }
  url.pathname = executionPath(url.pathname, execPath);
  url.hash = "";
  return url;
}

function executionConfig(
  options: ExecuteWebTTYCommandOptions,
  interactive: boolean,
): WebTTYExecutionConfig {
  return {
    allocateTty: options.allocateTty ?? false,
    cmdArgs: options.cmdArgs,
    envVars: options.envVars,
    interactive,
    payloadCrypto: options.payloadCrypto,
    username: options.username,
    workdir: options.workdir,
  };
}

function textFromByteArray(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

function textFromLogBytes(chunks: readonly WebTTYCommandLogBytes[]): string {
  return chunks.map((chunk) => new TextDecoder().decode(chunk.data)).join("");
}

function timeoutHandle(
  timeoutMs: number | undefined,
  callback: () => void,
): ReturnType<typeof setTimeout> | null {
  return timeoutMs === undefined ? null : setTimeout(callback, timeoutMs);
}

function signalError(signal: AbortSignal): Error {
  const reason = signal.reason;
  return reason instanceof Error
    ? reason
    : new Error(reason === undefined ? "Operation aborted." : String(reason));
}

function signalPromise(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_, reject) => {
    signal.addEventListener("abort", () => reject(signalError(signal)), {
      once: true,
    });
  });
}

function withSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.reject(signalError(signal));
  return Promise.race([promise, signalPromise(signal)]);
}

function stdinStream(command: WebTTYCommand): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    close: () => command.closeStdin(),
    write: (chunk) => command.writeStdin(chunk),
  });
}

function abortCleanup(
  signal: AbortSignal | undefined,
  callback: () => void,
): () => void {
  if (signal === undefined) return () => undefined;
  if (signal.aborted) {
    callback();
    return () => undefined;
  }
  const listener = () => callback();
  signal.addEventListener("abort", listener, { once: true });
  return () => signal.removeEventListener("abort", listener);
}

async function resolveURL(url: WebTTYURLProvider): Promise<string | URL> {
  return typeof url === "function" ? await url() : url;
}

function clientConfig(
  config: WebTTYRemoteExecutorConfig,
  url: string | URL,
  execPath: string | undefined,
): WebTTYClientConfig {
  return {
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    sendHeartbeat: config.sendHeartbeat,
    url:
      execPath === undefined ? url : resolveWebTTYExecutionURL(url, execPath),
  };
}

function executionClientConfig(
  client: WebTTYClientConfig,
  execPath: string | undefined,
): WebTTYClientConfig {
  return execPath === undefined
    ? client
    : { ...client, url: resolveWebTTYExecutionURL(client.url, execPath) };
}

async function* streamValues<T>(
  stream: ReadableStream<T>,
): AsyncGenerator<T, void, void> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) return;
      yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
}

function successStatus(exitCode: number): WebTTYCommandStatus {
  return { exitCode, success: exitCode === 0 };
}

function envEntry(
  key: string,
  value: string | undefined,
): { key: string; value: string } | null {
  return value === undefined ? null : { key, value };
}

function presentEnvEntries(
  entries: readonly ({ key: string; value: string } | null)[],
): Array<{ key: string; value: string }> {
  return entries.filter(
    (entry): entry is { key: string; value: string } => entry !== null,
  );
}

function envVarsFromRecord(
  env: Record<string, string | undefined> | undefined,
): Array<{ key: string; value: string }> | undefined {
  return env === undefined
    ? undefined
    : presentEnvEntries(
        Object.entries(env).map(([key, value]) => envEntry(key, value)),
      );
}

function commandExecutionOptions(
  command: string,
  args: readonly string[],
  options: WebTTYRunCommandOptions,
): ExecuteWebTTYCommandOptions {
  return {
    allocateTty: options.allocateTty,
    cmdArgs: [command, ...args],
    envVars: envVarsFromRecord(options.env),
    execPath: options.execPath,
    input: options.stdin,
    interactive: options.interactive,
    payloadCrypto: options.payloadCrypto,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    username: options.username,
    workdir: options.cwd,
  };
}

export class WebTTYCommand {
  private readonly abort: () => void;
  private readonly connected = new Deferred<void>();
  private readonly completion = new Deferred<WebTTYCommandStatus>();
  private readonly logsChannel =
    new ReplayStreamChannel<WebTTYCommandLogBytes>();
  private readonly stderrChannel = new ReplayStreamChannel<Uint8Array>();
  private readonly stdoutChannel = new ReplayStreamChannel<Uint8Array>();
  private readonly timer: ReturnType<typeof setTimeout> | null;
  private readonly webtty: WebTTY;
  private settled = false;
  public exitCode: number | null = null;
  public readonly stdin: WritableStream<Uint8Array> | undefined;
  public constructor(
    client: WebTTYClientConfig,
    options: ExecuteWebTTYCommandOptions,
  ) {
    const interactive = resolveInteractive(options);
    this.webtty = new WebTTY(
      executionClientConfig(client, options.execPath),
      executionConfig(options, interactive),
      {
        onComplete: (exitCode) => this.complete(exitCode),
        onConnect: () => this.connect(options.input),
        onError: (message) => this.fail(new Error(message)),
        onStderr: (chunk) => this.append("stderr", chunk),
        onStderrEos: () => this.stderrChannel.close(),
        onStdout: (chunk) => this.append("stdout", chunk),
        onStdoutEos: () => this.stdoutChannel.close(),
      },
    );
    this.stdin = interactive ? stdinStream(this) : undefined;
    this.abort = abortCleanup(options.signal, () => {
      this.fail(new Error("WebTTY command was aborted."));
    });
    this.timer = timeoutHandle(options.timeoutMs, () => {
      this.fail(new Error("WebTTY command timed out."));
    });
    this.webtty.connect();
  }
  public async closeStdin(): Promise<void> {
    await this.connected.promise;
    this.webtty.closeStdin();
  }
  public disconnect(): void {
    this.webtty.disconnect();
  }
  public async kill(): Promise<void> {
    this.disconnect();
    await this.completion.promise.catch(() => undefined);
  }
  public async *logBytes(): AsyncGenerator<WebTTYCommandLogBytes, void, void> {
    yield* streamValues(this.logsChannel.stream());
  }
  public async *logs(): AsyncGenerator<WebTTYCommandLog, void, void> {
    for await (const entry of this.logBytes()) {
      yield {
        data: new TextDecoder().decode(entry.data),
        stream: entry.stream,
      };
    }
  }
  public output(
    stream: WebTTYCommandOutput = "both",
    options: WebTTYCommandReadOptions = {},
  ): Promise<string> {
    if (stream === "stdout") return this.stdout(options);
    if (stream === "stderr") return this.stderr(options);
    return this.logsChannel
      .valuesAfterClose(options)
      .then((chunks) => textFromLogBytes(chunks));
  }
  public stderr(options: WebTTYCommandReadOptions = {}): Promise<string> {
    return this.stderrBytes(options).then(textFromByteArray);
  }
  public stderrBytes(
    options: WebTTYCommandReadOptions = {},
  ): Promise<Uint8Array> {
    return this.stderrChannel
      .valuesAfterClose(options)
      .then((chunks) => concatBytes(chunks));
  }
  public stderrStream(): ReadableStream<Uint8Array> {
    return this.stderrChannel.stream();
  }
  public stdout(options: WebTTYCommandReadOptions = {}): Promise<string> {
    return this.stdoutBytes(options).then(textFromByteArray);
  }
  public stdoutBytes(
    options: WebTTYCommandReadOptions = {},
  ): Promise<Uint8Array> {
    return this.stdoutChannel
      .valuesAfterClose(options)
      .then((chunks) => concatBytes(chunks));
  }
  public stdoutStream(): ReadableStream<Uint8Array> {
    return this.stdoutChannel.stream();
  }
  public async wait(
    options: WebTTYCommandReadOptions = {},
  ): Promise<WebTTYCommandStatus> {
    return await withSignal(this.completion.promise, options.signal);
  }
  public async terminate(): Promise<void> {
    await this.kill();
  }
  public async writeStdin(input: string | Uint8Array): Promise<void> {
    await this.connected.promise;
    await this.webtty.writeStdinAsync(encodeInput(input));
  }
  private append(stream: WebTTYCommandStream, chunk: Uint8Array): void {
    if (stream === "stdout") this.stdoutChannel.append(chunk);
    if (stream === "stderr") this.stderrChannel.append(chunk);
    this.logsChannel.append({ data: chunk, stream });
  }
  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
  }
  private complete(exitCode: number): void {
    if (this.settled) return;
    this.settled = true;
    this.exitCode = exitCode;
    this.abort();
    this.clearTimer();
    this.stdoutChannel.close();
    this.stderrChannel.close();
    this.logsChannel.close();
    this.completion.resolve(successStatus(exitCode));
  }
  private connect(input: string | Uint8Array | undefined): void {
    this.connected.resolve();
    if (input === undefined) return;
    const bytes = encodeInput(input);
    try {
      this.webtty.writeStdin(bytes);
      this.webtty.closeStdin();
      return;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("writeStdinAsync")
      ) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }
    }
    this.writeInitialInput(bytes).catch((error: unknown) => {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    });
  }
  private async writeInitialInput(input: Uint8Array): Promise<void> {
    await this.webtty.writeStdinAsync(input);
    this.webtty.closeStdin();
  }
  private fail(error: Error): void {
    if (this.settled) return;
    this.settled = true;
    this.abort();
    this.clearTimer();
    this.stdoutChannel.error(error);
    this.stderrChannel.error(error);
    this.logsChannel.error(error);
    this.connected.reject(error);
    this.completion.reject(error);
    this.webtty.disconnect();
  }
}

export function openWebTTYCommand(
  client: WebTTYClientConfig,
  options: ExecuteWebTTYCommandOptions = {},
): WebTTYCommand {
  return new WebTTYCommand(client, options);
}

export async function runWebTTYCommand(
  client: WebTTYClientConfig,
  command: string,
  args: readonly string[] = [],
  options: WebTTYRunCommandOptions = {},
): Promise<WebTTYCommandResult> {
  return await executeWebTTYCommand(
    client,
    commandExecutionOptions(command, args, options),
  );
}

export async function executeWebTTYCommand(
  client: WebTTYClientConfig,
  options: ExecuteWebTTYCommandOptions = {},
): Promise<WebTTYCommandResult> {
  const command = openWebTTYCommand(client, options);
  const [stdout, stderr, status] = await Promise.all([
    command.stdout(),
    command.stderr(),
    command.wait(),
  ]);
  return { exitCode: status.exitCode, stderr, stdout, success: status.success };
}

export class WebTTYRemoteExecutor {
  private readonly config: WebTTYRemoteExecutorConfig;
  public constructor(config: WebTTYRemoteExecutorConfig) {
    this.config = config;
  }
  public async execute(
    options: ExecuteWebTTYCommandOptions = {},
  ): Promise<WebTTYCommandResult> {
    const execPath = options.execPath ?? this.config.execPath;
    return await executeWebTTYCommand(
      clientConfig(this.config, await resolveURL(this.config.url), execPath),
      { ...options, execPath: undefined },
    );
  }
  public async open(
    options: ExecuteWebTTYCommandOptions = {},
  ): Promise<WebTTYCommand> {
    const execPath = options.execPath ?? this.config.execPath;
    return openWebTTYCommand(
      clientConfig(this.config, await resolveURL(this.config.url), execPath),
      { ...options, execPath: undefined },
    );
  }
  public async openCommand(
    command: string,
    args: readonly string[] = [],
    options: WebTTYRunCommandOptions = {},
  ): Promise<WebTTYCommand> {
    const execPath = options.execPath ?? this.config.execPath;
    return openWebTTYCommand(
      clientConfig(this.config, await resolveURL(this.config.url), execPath),
      commandExecutionOptions(command, args, {
        ...options,
        execPath: undefined,
      }),
    );
  }
  public async runCommand(
    command: string,
    args: readonly string[] = [],
    options: WebTTYRunCommandOptions = {},
  ): Promise<WebTTYCommandResult> {
    const execPath = options.execPath ?? this.config.execPath;
    return await runWebTTYCommand(
      clientConfig(this.config, await resolveURL(this.config.url), execPath),
      command,
      args,
      { ...options, execPath: undefined },
    );
  }
}
