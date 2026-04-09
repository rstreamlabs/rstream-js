// See LICENSE file in the project root for license information.

import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebTTY } from "@rstreamlabs/webtty";
import * as React from "react";
import type { IDisposable } from "@xterm/xterm";
import type { ITerminalOptions } from "@xterm/xterm";
import type { WebTTYClientConfig } from "@rstreamlabs/webtty";
import type { WebTTYEvents } from "@rstreamlabs/webtty";
import type { WebTTYExecutionConfig } from "@rstreamlabs/webtty";

export interface WebTTYTerminalProps
  extends WebTTYClientConfig, WebTTYExecutionConfig, WebTTYEvents {
  /**
   * xterm.js TerminalOptions override
   */
  terminalOptions?: ITerminalOptions;
  /**
   * Called once the xterm Terminal is created (before connect).
   * Can be used to add your own add-ons or manipulate the Terminal instance.
   */
  onTerminalCreated?: (terminal: Terminal) => void;
  /**
   * Called whenever the terminal title changes.
   */
  onTitleChange?: (title: string) => void;
}

/**
 * A React component that binds a WebTTY session to an xterm.js instance.
 */
interface WebTTYRuntime {
  connected: boolean;
  disposeOnData: IDisposable | null;
  disposeOnResize: IDisposable | null;
  disposeOnTitleChange: IDisposable | null;
  resizeObserver: ResizeObserver | null;
  syncedCols: number;
  syncedRows: number;
}

export function WebTTYTerminal(props: WebTTYTerminalProps) {
  const ref = React.useRef<HTMLDivElement>(null);
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
    if (!ref.current) {
      return;
    }
    const {
      allocateTty,
      cmdArgs,
      envVars,
      heartbeatIntervalMs,
      interactive,
      sendHeartbeat,
      terminalOptions,
      url,
      username,
      workdir,
    } = initialPropsRef.current;
    const runtime: WebTTYRuntime = {
      connected: false,
      disposeOnData: null,
      disposeOnResize: null,
      disposeOnTitleChange: null,
      resizeObserver: null,
      syncedCols: 0,
      syncedRows: 0,
    };
    const textDecoder = new TextDecoder();
    const textEncoder = new TextEncoder();
    const clear = () => {
      runtime.disposeOnData?.dispose();
      runtime.disposeOnData = null;
      runtime.disposeOnResize?.dispose();
      runtime.disposeOnResize = null;
      runtime.disposeOnTitleChange?.dispose();
      runtime.disposeOnTitleChange = null;
      runtime.resizeObserver?.disconnect();
      runtime.resizeObserver = null;
      runtime.connected = false;
      runtime.syncedRows = 0;
      runtime.syncedCols = 0;
    };
    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: false,
      scrollback: 10000,
      ...terminalOptions,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.loadAddon(new Unicode11Addon());
    try {
      terminal.loadAddon(new WebglAddon());
    } catch (err) {
      console.warn("WebGL addon could not be loaded:", err);
    }
    terminal.open(ref.current);
    const fit = () => {
      const container = ref.current;
      if (!container) return false;
      if (container.clientWidth === 0 || container.clientHeight === 0) {
        return false;
      }
      try {
        fitAddon.fit();
      } catch {
        return false;
      }
      return true;
    };
    const syncRemoteSize = (rows: number, cols: number) => {
      if (!runtime.connected) return;
      if (rows < 1 || cols < 1) return;
      if (rows === runtime.syncedRows && cols === runtime.syncedCols) return;
      runtime.syncedRows = rows;
      runtime.syncedCols = cols;
      try {
        webtty.resize(rows, cols);
      } catch (e) {
        console.error("Cannot resize remote TTY:", e);
      }
    };
    onTerminalCreatedEvent(terminal);
    runtime.disposeOnTitleChange = terminal.onTitleChange((title) => {
      onTitleChangeEvent(title);
    });
    const webtty = new WebTTY(
      { url, sendHeartbeat, heartbeatIntervalMs },
      { cmdArgs, envVars, allocateTty, interactive, username, workdir },
      {
        onStdout: (chunk) => {
          onStdoutEvent(chunk);
          terminal.write(chunk);
        },
        onStdoutEos: () => {
          onStdoutEosEvent();
        },
        onStderr: (chunk) => {
          onStderrEvent(chunk);
          terminal.write("\x1b[31m" + textDecoder.decode(chunk) + "\x1b[0m");
        },
        onStderrEos: () => {
          onStderrEosEvent();
        },
        onConnect: () => {
          runtime.connected = true;
          onConnectEvent();
          terminal.focus();
          fit();
          syncRemoteSize(terminal.rows, terminal.cols);
          runtime.disposeOnData = terminal.onData((data) => {
            try {
              webtty.writeStdin(textEncoder.encode(data));
            } catch (e) {
              console.error("Cannot writeStdin:", e);
            }
          });
          runtime.disposeOnResize = terminal.onResize((size) => {
            syncRemoteSize(size.rows, size.cols);
          });
        },
        onComplete: (code) => {
          onCompleteEvent(code);
          terminal.write(`\r\nProcess exited with code ${code}.`);
          terminal.write("\x1b[?25l");
          clear();
        },
        onError: (err) => {
          onErrorEvent(err);
          terminal.write(`\r\n[ERROR] ${err}`);
          terminal.write("\x1b[?25l");
          clear();
        },
      },
    );
    webtty.connect();
    runtime.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === ref.current) {
          if (!fit()) return;
          syncRemoteSize(terminal.rows, terminal.cols);
        }
      }
    });
    runtime.resizeObserver.observe(ref.current);
    fit();
    return () => {
      clear();
      webtty.disconnect();
      terminal.dispose();
    };
  }, []);
  return <div ref={ref} style={{ height: "100%", width: "100%" }} />;
}
