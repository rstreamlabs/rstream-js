// See LICENSE file in the project root for license information.

import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, ITerminalOptions, IDisposable } from "@xterm/xterm";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import {
  WebTTY,
  WebTTYClientConfig,
  WebTTYExecutionConfig,
  WebTTYEvents,
} from "@rstreamlabs/webtty";
import * as React from "react";

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
export function WebTTYTerminal(props: WebTTYTerminalProps) {
  const {
    // WebTTY client config
    url,
    sendHeartbeat,
    heartbeatIntervalMs,
    // Execution config
    cmdArgs,
    envVars,
    allocateTty,
    interactive,
    username,
    workdir,
    // Events
    onStdout,
    onStdoutEos,
    onStderr,
    onStderrEos,
    onConnect,
    onComplete,
    onError,
    // xterm.js options
    terminalOptions,
    // Callbacks
    onTerminalCreated,
    onTitleChange,
  } = props;
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!ref.current) {
      return;
    }
    let disposeOnData: IDisposable | null = null;
    let disposeOnResize: IDisposable | null = null;
    let disposeOnTitleChange: IDisposable | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let connected = false;
    let syncedRows = 0;
    let syncedCols = 0;
    const clear = () => {
      disposeOnData?.dispose();
      disposeOnData = null;
      disposeOnResize?.dispose();
      disposeOnResize = null;
      disposeOnTitleChange?.dispose();
      disposeOnTitleChange = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
      connected = false;
      syncedRows = 0;
      syncedCols = 0;
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
      if (!connected) return;
      if (rows < 1 || cols < 1) return;
      if (rows === syncedRows && cols === syncedCols) return;
      syncedRows = rows;
      syncedCols = cols;
      try {
        webtty.resize(rows, cols);
      } catch (e) {
        console.error("Cannot resize remote TTY:", e);
      }
    };
    onTerminalCreated?.(terminal);
    disposeOnTitleChange = terminal.onTitleChange((title) => {
      onTitleChange?.(title);
    });
    const webtty = new WebTTY(
      { url, sendHeartbeat, heartbeatIntervalMs },
      { cmdArgs, envVars, allocateTty, interactive, username, workdir },
      {
        onStdout: (chunk) => {
          onStdout?.(chunk);
          terminal.write(chunk);
        },
        onStdoutEos: () => {
          onStdoutEos?.();
        },
        onStderr: (chunk) => {
          onStderr?.(chunk);
          terminal.write(
            "\x1b[31m" + new TextDecoder().decode(chunk) + "\x1b[0m",
          );
        },
        onStderrEos: () => {
          onStderrEos?.();
        },
        onConnect: () => {
          connected = true;
          onConnect?.();
          terminal.focus();
          fit();
          syncRemoteSize(terminal.rows, terminal.cols);
          disposeOnData = terminal.onData((data) => {
            try {
              webtty.writeStdin(new TextEncoder().encode(data));
            } catch (e) {
              console.error("Cannot writeStdin:", e);
            }
          });
          disposeOnResize = terminal.onResize((size) => {
            syncRemoteSize(size.rows, size.cols);
          });
        },
        onComplete: (code) => {
          onComplete?.(code);
          terminal.write(`\r\nProcess exited with code ${code}.`);
          terminal.write("\x1b[?25l");
          clear();
        },
        onError: (err) => {
          onError?.(err);
          terminal.write(`\r\n[ERROR] ${err}`);
          terminal.write("\x1b[?25l");
          clear();
        },
      },
    );
    webtty.connect();
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === ref.current) {
          if (!fit()) return;
          syncRemoteSize(terminal.rows, terminal.cols);
        }
      }
    });
    resizeObserver.observe(ref.current);
    fit();
    return () => {
      clear();
      webtty.disconnect();
      terminal.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={ref} style={{ height: "100%", width: "100%" }} />;
}
