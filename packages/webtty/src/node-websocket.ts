// See LICENSE file in the project root for license information.

import WebSocket from "ws";
import type { WebTTYWebSocketFactory } from "./webtty";

/** Node.js WebSocket transport with bounded handshake, payload and shutdown. */
export const nodeWebSocketFactory: WebTTYWebSocketFactory = (url, options) => {
  const socketOptions = {
    closeTimeout: 1000,
    handshakeTimeout: 10000,
    maxPayload: options.maxMessageSize,
    perMessageDeflate: false,
  };
  const socket = new WebSocket(url, socketOptions);
  socket.binaryType = "arraybuffer";
  socket.on("error", () => undefined);
  return socket;
};
