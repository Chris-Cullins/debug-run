/**
 * Socket-based DAP Transport Layer
 *
 * Handles DAP communication over TCP sockets (used by js-debug and others).
 */

import { Socket, connect } from "node:net";
import { EventEmitter } from "node:events";
import type { ProtocolMessage, Request, Response, Event } from "./protocol.js";

const HEADER_DELIMITER = "\r\n\r\n";
const CONTENT_LENGTH_HEADER = "Content-Length: ";

interface PendingRequest {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  command: string;
  timeout: NodeJS.Timeout;
}

export interface SocketTransportOptions {
  host: string;
  port: number;
  requestTimeout?: number;
}

export class SocketDapTransport extends EventEmitter {
  private socket: Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private pendingRequests: Map<number, PendingRequest> = new Map();
  private seq: number = 1;
  private requestTimeout: number;
  private closed: boolean = false;
  private options: SocketTransportOptions;

  constructor(options: SocketTransportOptions) {
    super();
    this.options = options;
    this.requestTimeout = options.requestTimeout ?? 30000;
  }

  /**
   * Connect to the DAP server
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = connect({
        host: this.options.host,
        port: this.options.port,
      });

      const onError = (err: Error) => {
        this.socket?.removeListener("connect", onConnect);
        reject(err);
      };

      const onConnect = () => {
        this.socket?.removeListener("error", onError);
        this.setupSocket();
        resolve();
      };

      this.socket.once("error", onError);
      this.socket.once("connect", onConnect);
    });
  }

  private setupSocket(): void {
    if (!this.socket) return;

    this.socket.on("data", (chunk: Buffer) => this.onData(chunk));

    this.socket.on("close", () => {
      this.closed = true;
      this.rejectAllPending(new Error("Socket closed"));
      this.emit("exit", 0, null);
    });

    this.socket.on("error", (error) => {
      this.closed = true;
      this.rejectAllPending(error);
      this.emit("error", error);
    });
  }

  /**
   * Send a DAP request and wait for the response
   */
  async sendRequest<T>(command: string, args?: unknown): Promise<T> {
    if (this.closed || !this.socket) {
      throw new Error("Transport is closed");
    }

    const seq = this.seq++;
    const request: Request = {
      seq,
      type: "request",
      command,
      arguments: args,
    };

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(seq);
        reject(
          new Error(`Request '${command}' timed out after ${this.requestTimeout}ms`)
        );
      }, this.requestTimeout);

      this.pendingRequests.set(seq, {
        resolve: (response: Response) => {
          clearTimeout(timeout);
          if (response.success) {
            resolve(response.body as T);
          } else {
            reject(new Error(response.message || `Request '${command}' failed`));
          }
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        },
        command,
        timeout,
      });

      this.send(request);
    });
  }

  /**
   * Close the transport
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectAllPending(new Error("Transport closed"));
    this.socket?.destroy();
    this.socket = null;
  }

  /**
   * Check if the transport is still open
   */
  isOpen(): boolean {
    return !this.closed && this.socket !== null;
  }

  /**
   * Send a response to a reverse request from the debug adapter
   */
  sendResponse(requestSeq: number, command: string, success: boolean = true, body?: unknown, message?: string): void {
    const response: Response = {
      seq: this.seq++,
      type: "response",
      request_seq: requestSeq,
      command,
      success,
      body,
      message,
    };
    this.send(response);
  }

  /**
   * Send a message to the debug adapter
   */
  send(message: ProtocolMessage): void {
    if (this.closed || !this.socket?.writable) {
      return;
    }

    // Debug logging
    if (process.env.DEBUG_DAP) {
      const summary = message.type === "request"
        ? `request:${(message as Request).command}`
        : `response:${(message as Response).command}`;
      console.error(`[DAP send] ${summary}`);
    }

    const json = JSON.stringify(message);
    const contentLength = Buffer.byteLength(json, "utf-8");
    const header = `${CONTENT_LENGTH_HEADER}${contentLength}${HEADER_DELIMITER}`;

    this.socket.write(header + json);
    this.emit("sent", message);
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.processBuffer();
  }

  private processBuffer(): void {
    while (true) {
      const message = this.extractMessage();
      if (!message) break;
      this.handleMessage(message);
    }
  }

  private extractMessage(): ProtocolMessage | null {
    const headerEnd = this.buffer.indexOf(HEADER_DELIMITER);
    if (headerEnd === -1) return null;

    const headerStr = this.buffer.subarray(0, headerEnd).toString("utf-8");
    const match = headerStr.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      this.buffer = this.buffer.subarray(headerEnd + HEADER_DELIMITER.length);
      return null;
    }

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + HEADER_DELIMITER.length;
    const bodyEnd = bodyStart + contentLength;

    if (this.buffer.length < bodyEnd) return null;

    const bodyStr = this.buffer.subarray(bodyStart, bodyEnd).toString("utf-8");
    this.buffer = this.buffer.subarray(bodyEnd);

    try {
      return JSON.parse(bodyStr) as ProtocolMessage;
    } catch {
      this.emit("parseError", bodyStr);
      return null;
    }
  }

  private handleMessage(message: ProtocolMessage): void {
    // Debug logging
    if (process.env.DEBUG_DAP) {
      const summary = message.type === "event"
        ? `event:${(message as Event).event}`
        : message.type === "response"
          ? `response:${(message as Response).command}:${(message as Response).success}`
          : `request:${(message as Request).command}`;
      console.error(`[DAP recv] ${summary}`);
    }

    this.emit("message", message);

    switch (message.type) {
      case "response":
        this.handleResponse(message as Response);
        break;
      case "event":
        this.handleEvent(message as Event);
        break;
      case "request":
        // Log reverse requests in detail for debugging
        if (process.env.DEBUG_DAP) {
          console.error(`[DAP reverse request] ${(message as Request).command}:`, JSON.stringify((message as Request).arguments, null, 2));
        }
        this.emit("reverseRequest", message as Request);
        this.emit(`reverseRequest:${(message as Request).command}`, message as Request);
        break;
    }
  }

  private handleResponse(response: Response): void {
    const pending = this.pendingRequests.get(response.request_seq);
    if (pending) {
      this.pendingRequests.delete(response.request_seq);
      pending.resolve(response);
    }
    this.emit("response", response);
  }

  private handleEvent(event: Event): void {
    this.emit("event", event);
    this.emit(`event:${event.event}`, event.body);
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}
