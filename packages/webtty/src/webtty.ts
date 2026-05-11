// See LICENSE file in the project root for license information.

import * as WebTTYProto from "../.generated/protobuf/webtty";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getWebSocketPayload(
  payload: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> {
  return new Uint8Array(payload);
}

/**
 * Client-level configuration for WebTTY.
 */
export interface WebTTYClientConfig {
  /**
   * The remote WebSocket endpoint.
   */
  url: string | URL;

  /**
   * Whether to send heartbeats to keep the session alive.
   *
   * @default true
   */
  sendHeartbeat?: boolean;

  /**
   * Heartbeat interval in milliseconds.
   *
   * @default 5000
   */
  heartbeatIntervalMs?: number;
}

/**
 * Execution-level configuration for WebTTY.
 */
export interface WebTTYExecutionConfig {
  /**
   * Command arguments to run on the remote side.
   */
  cmdArgs?: string[];

  /**
   * Environment variables to set for the remote session.
   */
  envVars?: Array<{ key: string; value: string }>;

  /**
   * Whether the server should allocate a TTY.
   *
   * @default true
   */
  allocateTty?: boolean;

  /**
   * Whether the session is interactive.
   *
   * @default true
   */
  interactive?: boolean;

  /**
   * Optional username (by name or ID).
   */
  username?: string | number;

  /**
   * Optional working directory for the remote process.
   */
  workdir?: string;
}

/**
 * WebTTY events for handling session state and data streams.
 */
export interface WebTTYEvents {
  /**
   * Called whenever the server sends data on STDOUT.
   */
  onStdout?: (chunk: Uint8Array) => void;

  /**
   * Called whenever STDOUT reaches end-of-stream.
   */
  onStdoutEos?: () => void;

  /**
   * Called whenever the server sends data on STDERR.
   */
  onStderr?: (chunk: Uint8Array) => void;

  /**
   * Called whenever STDERR reaches end-of-stream.
   */
  onStderrEos?: () => void;

  /**
   * Called when the connection is established.
   */
  onConnect?: () => void;

  /**
   * Called when the remote process exits, providing the exit code.
   */
  onComplete?: (exitCode: number) => void;

  /**
   * Called when the server or connection encounters an error.
   */
  onError?: (errMsg: string) => void;
}

/**
 * Possible internal states of the WebTTY's connection lifecycle.
 */
type ConnectionState = "preparing" | "connecting" | "connected" | "closed";
type ResolvedWebTTYClientConfig = WebTTYClientConfig & {
  heartbeatIntervalMs: number;
  sendHeartbeat: boolean;
};
type ResolvedWebTTYExecutionConfig = WebTTYExecutionConfig & {
  allocateTty: boolean;
  envVars: Array<{ key: string; value: string }>;
  interactive: boolean;
};

/**
 * WebTTY client for managing remote execution sessions.
 */
export class WebTTY {
  private ws: WebSocket | null = null;
  private connectionState: ConnectionState = "preparing";
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly clientConfig: ResolvedWebTTYClientConfig;
  private readonly execConfig: ResolvedWebTTYExecutionConfig;
  private readonly events: WebTTYEvents;

  /**
   * Creates a new WebTTY instance.
   *
   * @param clientConfig - WebSocket connection configuration.
   * @param execConfig - Execution parameters.
   * @param events - Event callbacks for the session.
   */
  constructor(
    clientConfig: WebTTYClientConfig,
    execConfig?: WebTTYExecutionConfig,
    events?: WebTTYEvents,
  ) {
    this.clientConfig = {
      heartbeatIntervalMs: clientConfig.heartbeatIntervalMs ?? 5000,
      sendHeartbeat: clientConfig.sendHeartbeat ?? true,
      url: clientConfig.url,
    };
    this.execConfig = {
      allocateTty: execConfig?.allocateTty ?? true,
      cmdArgs: execConfig?.cmdArgs,
      envVars: execConfig?.envVars ?? [],
      interactive: execConfig?.interactive ?? true,
      username: execConfig?.username,
      workdir: execConfig?.workdir,
    };
    this.events = events || {};
  }

  /**
   * Connects to the WebTTY server and starts the session.
   */
  public connect(): void {
    if (this.connectionState !== "preparing") {
      throw new Error("Invalid state for connect().");
    }
    this.connectionState = "connecting";
    const wsUrl =
      typeof this.clientConfig.url === "string"
        ? this.clientConfig.url
        : this.clientConfig.url.toString();
    this.ws = new WebSocket(wsUrl);
    this.ws.binaryType = "arraybuffer";
    this.ws.addEventListener("open", this.handleOpen);
    this.ws.addEventListener("message", this.handleMessage);
    this.ws.addEventListener("error", this.handleError);
    this.ws.addEventListener("close", this.handleClose);
  }

  /**
   * Sends data to the remote server's STDIN.
   *
   * @param data - The data to send.
   */
  public writeStdin(data: Uint8Array): void {
    if (this.connectionState !== "connected" || !this.ws) {
      throw new Error("Invalid state for writeStdin().");
    }
    if (this.execConfig.interactive === false) {
      throw new Error("STDIN is unavailable in non-interactive mode.");
    }
    this.send(
      new WebTTYProto.rstream.webtty.protobuf.Message({
        data: new WebTTYProto.rstream.webtty.protobuf.Data({
          type: WebTTYProto.rstream.webtty.protobuf.Data.Type.TYPE_STDIN,
          data,
        }),
      }),
    );
  }

  /**
   * Closes the remote STDIN stream (EOF).
   */
  public closeStdin(): void {
    if (this.connectionState !== "connected" || !this.ws) {
      throw new Error("Invalid state for closeStdin().");
    }
    if (this.execConfig.interactive === false) {
      throw new Error("STDIN is unavailable in non-interactive mode.");
    }
    this.send(
      new WebTTYProto.rstream.webtty.protobuf.Message({
        data: new WebTTYProto.rstream.webtty.protobuf.Data({
          type: WebTTYProto.rstream.webtty.protobuf.Data.Type.TYPE_STDIN,
          eos: new WebTTYProto.rstream.webtty.protobuf.EndOfStream(),
        }),
      }),
    );
  }

  /**
   * Sends a "resize" request to the remote TTY with the provided rows and columns (and optional pixel sizes).
   */
  public resize(rows: number, cols: number, xpixel = 0, ypixel = 0): void {
    if (this.connectionState !== "connected" || !this.ws) {
      throw new Error("Invalid state for resize().");
    }
    if (this.execConfig.allocateTty === false) {
      throw new Error("Resize is unavailable in non-TTY mode.");
    }
    const parameter = new WebTTYProto.rstream.webtty.protobuf.TerminalSize({
      row: rows,
      col: cols,
      xpixel,
      ypixel,
    });
    const payload = new WebTTYProto.rstream.webtty.protobuf.Parameter({
      terminalSize: parameter,
    });
    const msg = new WebTTYProto.rstream.webtty.protobuf.Message({
      parameter: payload,
    });
    this.send(msg);
  }

  /**
   * Terminates the WebTTY session immediately.
   */
  public disconnect(): void {
    this.close("Session terminated by client.");
  }

  // ---------------------------------------------------------------------------------------------
  // Internal Handlers
  // ---------------------------------------------------------------------------------------------

  private handleOpen = (): void => {
    if (this.connectionState !== "connecting") {
      return;
    }
    const opts = new WebTTYProto.rstream.webtty.protobuf.Options({
      interactive: this.execConfig.interactive,
      allocateTty: this.execConfig.allocateTty,
      sendHeartbeat: this.clientConfig.sendHeartbeat,
    });
    const config = new WebTTYProto.rstream.webtty.protobuf.Config({
      options: opts,
      cmdArgs: this.execConfig.cmdArgs,
      envVars: this.execConfig.envVars.map(
        (e) =>
          new WebTTYProto.rstream.webtty.protobuf.Environment({
            key: e.key,
            value: e.value,
          }),
      ),
      workdir: this.execConfig.workdir
        ? new WebTTYProto.rstream.webtty.protobuf.Workdir({
            value: this.execConfig.workdir,
          })
        : undefined,
      username:
        typeof this.execConfig.username === "string"
          ? new WebTTYProto.rstream.webtty.protobuf.Username({
              name: this.execConfig.username,
            })
          : this.execConfig.username !== undefined
            ? new WebTTYProto.rstream.webtty.protobuf.Username({
                id: this.execConfig.username,
              })
            : undefined,
    });
    this.send(
      new WebTTYProto.rstream.webtty.protobuf.Message({
        open: new WebTTYProto.rstream.webtty.protobuf.Open({ config }),
      }),
    );
  };

  private handleMessage = (evt: MessageEvent): void => {
    if (!evt.data) return;
    if (
      this.connectionState === "preparing" ||
      this.connectionState === "closed"
    )
      return;
    try {
      const message = WebTTYProto.rstream.webtty.protobuf.Message.decode(
        new Uint8Array(evt.data),
      );
      if (message.error) {
        this.close(`Server error (${message.error.msg})`);
      } else if (message.ack) {
        if (this.connectionState === "connecting") {
          this.connectionState = "connected";
          this.events.onConnect?.();
          if (this.clientConfig.sendHeartbeat) {
            this.heartbeatTimer = setInterval(
              () => this.sendHeartbeat(),
              this.clientConfig.heartbeatIntervalMs,
            );
          }
        } else {
          this.close("Unexpected ACK message.");
        }
      } else if (message.close) {
        this.close(message.close.returnCode ?? 0);
      } else if (message.data) {
        if (this.connectionState === "connected") {
          if (
            message.data.type ===
            WebTTYProto.rstream.webtty.protobuf.Data.Type.TYPE_STDOUT
          ) {
            if (message.data.data) {
              this.events.onStdout?.(message.data.data);
            }
            if (message.data.eos) {
              this.events.onStdoutEos?.();
            }
          } else if (
            message.data.type ===
            WebTTYProto.rstream.webtty.protobuf.Data.Type.TYPE_STDERR
          ) {
            if (message.data.data) {
              this.events.onStderr?.(message.data.data);
            }
            if (message.data.eos) {
              this.events.onStderrEos?.();
            }
          }
        } else {
          this.close("Unexpected data message.");
        }
      }
    } catch (error) {
      this.close(`Failed to decode message: ${getErrorMessage(error)}`);
    }
  };

  private handleClose = (): void => {
    if (this.connectionState !== "closed") {
      this.close("WebSocket was closed unexpectedly.");
    }
  };

  private handleError = (): void => {
    if (this.connectionState !== "closed") {
      this.close("WebSocket encountered an error.");
    }
  };

  private sendHeartbeat(): void {
    this.send(
      new WebTTYProto.rstream.webtty.protobuf.Message({
        heartbeat: new WebTTYProto.rstream.webtty.protobuf.Heartbeat(),
      }),
    );
  }

  private send(message: WebTTYProto.rstream.webtty.protobuf.Message): void {
    if (!this.ws) return;
    if (
      this.connectionState === "preparing" ||
      this.connectionState === "closed"
    )
      return;
    const buffer =
      WebTTYProto.rstream.webtty.protobuf.Message.encode(message).finish();
    this.ws.send(getWebSocketPayload(buffer));
  }

  /**
   * Closes the WebTTY session and fires exactly one of:
   *   - onComplete(exitCode)       // if a number is passed
   *   - onError(errorMessage)      // if a string is passed
   * If no argument is given, treat as an unknown error scenario.
   */
  private close(result?: number | string): void {
    if (this.connectionState === "closed") {
      return;
    }
    this.connectionState = "closed";
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.ws) {
      this.ws.removeEventListener("open", this.handleOpen);
      this.ws.removeEventListener("message", this.handleMessage);
      this.ws.removeEventListener("error", this.handleError);
      this.ws.removeEventListener("close", this.handleClose);
      this.ws.close();
      this.ws = null;
    }
    if (typeof result === "number") {
      this.events.onComplete?.(result);
    } else if (typeof result === "string") {
      this.events.onError?.(result);
    } else {
      this.events.onError?.("Connection closed without a known reason.");
    }
  }
}
