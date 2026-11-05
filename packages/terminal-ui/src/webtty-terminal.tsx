// See LICENSE file in the project root for license information.

"use client";

import { resolveWebTTYExecutionURL } from "@rstreamlabs/webtty";
import { TerminalSurface } from "./surface.js";
import type { Terminal } from "@xterm/xterm";
import { WebTTY } from "@rstreamlabs/webtty";
import * as React from "react";
import type { IDisposable } from "@xterm/xterm";
import type { ITerminalOptions } from "@xterm/xterm";
import type { WebTTYClientConfig } from "@rstreamlabs/webtty";
import type { WebTTYEvents } from "@rstreamlabs/webtty";
import type { WebTTYExecutionConfig } from "@rstreamlabs/webtty";

export interface WebTTYTerminalProps
  extends WebTTYClientConfig, WebTTYExecutionConfig, WebTTYEvents {
  active?: boolean;
  clientCredential?: Uint8Array;
  execPath?: string;
  terminalOptions?: ITerminalOptions;
  onTerminalCreated?: (terminal: Terminal) => void;
  onSessionReady?: (session: WebTTY) => void;
  onTitleChange?: (title: string) => void;
  formatError?: (message: string) => string;
}

interface WebTTYRuntime {
  connected: boolean;
  disposeOnData: IDisposable | null;
  disposeOnResize: IDisposable | null;
  disposeOnTitleChange: IDisposable | null;
  syncedCols: number;
  syncedRows: number;
}

export function WebTTYTerminal(props: WebTTYTerminalProps) {
  const [terminal, setTerminal] = React.useState<Terminal | null>(null);
  const activeRef = React.useRef(props.active ?? true);
  React.useEffect(() => {
    activeRef.current = props.active ?? true;
  }, [props.active]);
  const initialPropsRef = React.useRef(props);
  const onStdoutEvent = React.useEffectEvent((chunk: Uint8Array) => {
    props.onStdout?.(chunk);
  });
  const onStdoutEosEvent = React.useEffectEvent(() => {
    props.onStdoutEos?.();
  });
  const onStderrEvent = React.useEffectEvent((chunk: Uint8Array) => {
    props.onStderr?.(chunk);
  });
  const onStderrEosEvent = React.useEffectEvent(() => {
    props.onStderrEos?.();
  });
  const onConnectEvent = React.useEffectEvent(() => {
    props.onConnect?.();
  });
  const onSessionReadyEvent = React.useEffectEvent((session: WebTTY) => {
    props.onSessionReady?.(session);
  });
  const onCompleteEvent = React.useEffectEvent((code: number) => {
    props.onComplete?.(code);
  });
  const onErrorEvent = React.useEffectEvent((message: string) => {
    props.onError?.(message);
  });
  const onTerminalCreatedEvent = React.useEffectEvent((terminal: Terminal) => {
    props.onTerminalCreated?.(terminal);
  });
  const onTitleChangeEvent = React.useEffectEvent((title: string) => {
    props.onTitleChange?.(title);
  });
  React.useEffect(() => {
    if (!terminal) {
      return;
    }
    const {
      allocateTty,
      attach,
      clientBrowserId,
      clientCredential,
      clientDeviceId,
      clientPrincipalId,
      cmdArgs,
      endpointIdentity,
      envVars,
      execPath,
      expectedServerIdentity,
      formatError,
      heartbeatIntervalMs,
      interactive,
      managed,
      maxMessageSize,
      payloadCrypto,
      sendHeartbeat,
      transport,
      url,
      username,
      webSocketFactory,
      webTransportOptions,
      workdir,
    } = initialPropsRef.current;
    const runtime: WebTTYRuntime = {
      connected: false,
      disposeOnData: null,
      disposeOnResize: null,
      disposeOnTitleChange: null,
      syncedCols: 0,
      syncedRows: 0,
    };
    let disposed = false;
    const textDecoder = new TextDecoder();
    const textEncoder = new TextEncoder();
    const clear = () => {
      runtime.disposeOnData?.dispose();
      runtime.disposeOnData = null;
      runtime.disposeOnResize?.dispose();
      runtime.disposeOnResize = null;
      runtime.disposeOnTitleChange?.dispose();
      runtime.disposeOnTitleChange = null;
      terminal.options.disableStdin = true;
      runtime.connected = false;
      runtime.syncedRows = 0;
      runtime.syncedCols = 0;
    };
    const syncRemoteSize = (rows: number, cols: number) => {
      if (!runtime.connected || allocateTty === false) return;
      if (rows < 1 || cols < 1) return;
      if (rows === runtime.syncedRows && cols === runtime.syncedCols) return;
      runtime.syncedRows = rows;
      runtime.syncedCols = cols;
      try {
        webtty.resize(rows, cols);
      } catch (err) {
        console.error("Cannot resize remote TTY:", err);
      }
    };
    onTerminalCreatedEvent(terminal);
    runtime.disposeOnTitleChange = terminal.onTitleChange((title) => {
      onTitleChangeEvent(title);
    });
    const connectionURL =
      execPath === undefined ? url : resolveWebTTYExecutionURL(url, execPath);
    const clientConfig: WebTTYClientConfig & { clientCredential?: Uint8Array } =
      {
        attach,
        clientBrowserId,
        clientCredential,
        clientDeviceId,
        clientPrincipalId,
        endpointIdentity,
        expectedServerIdentity,
        heartbeatIntervalMs,
        managed,
        maxMessageSize,
        sendHeartbeat,
        transport,
        url: connectionURL,
        webSocketFactory,
        webTransportOptions,
      };
    const webtty = new WebTTY(
      clientConfig,
      {
        allocateTty,
        cmdArgs,
        envVars,
        interactive,
        payloadCrypto,
        username,
        workdir,
      },
      {
        onComplete: (code) => {
          if (disposed) return;
          onCompleteEvent(code);
          terminal.write(`\r\nProcess exited with code ${code}.`);
          terminal.write("\x1b[?25l");
          clear();
        },
        onConnect: () => {
          if (disposed) return;
          runtime.connected = true;
          onConnectEvent();
          onSessionReadyEvent(webtty);
          terminal.options.disableStdin = false;
          if (activeRef.current) terminal.focus();
          syncRemoteSize(terminal.rows, terminal.cols);
          if (interactive !== false) {
            runtime.disposeOnData = terminal.onData((data) => {
              void webtty
                .writeStdinAsync(textEncoder.encode(data))
                .catch((err) => {
                  console.error("Cannot writeStdin:", err);
                });
            });
          }
          runtime.disposeOnResize = terminal.onResize((size) => {
            syncRemoteSize(size.rows, size.cols);
          });
        },
        onError: (err) => {
          if (disposed) return;
          const message = formatError ? formatError(err) : err;
          onErrorEvent(message);
          terminal.write(`\r\n[ERROR] ${message}`);
          terminal.write("\x1b[?25l");
          clear();
        },
        onStderr: (chunk) => {
          if (disposed) return;
          onStderrEvent(chunk);
          terminal.write("\x1b[31m" + textDecoder.decode(chunk) + "\x1b[0m");
        },
        onStderrEos: () => {
          if (disposed) return;
          onStderrEosEvent();
        },
        onStdout: (chunk) => {
          if (disposed) return;
          onStdoutEvent(chunk);
          terminal.write(chunk);
        },
        onStdoutEos: () => {
          if (disposed) return;
          onStdoutEosEvent();
        },
      },
    );
    webtty.connect();
    return () => {
      disposed = true;
      clear();
      webtty.disconnect();
    };
  }, [terminal]);
  return (
    <TerminalSurface
      active={props.active ?? true}
      terminalOptions={props.terminalOptions}
      onTerminalCreated={setTerminal}
      onData={() => {}}
      onResize={() => {}}
      onTitleChange={() => {}}
      onError={(message) => props.onError?.(message)}
    />
  );
}
