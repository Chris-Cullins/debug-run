/**
 * DAP Transport Layer
 *
 * Handles the wire protocol for DAP communication:
 * - Content-Length framing
 * - stdin/stdout communication with debug adapter process
 * - Request/response correlation via sequence numbers
 * - Event dispatching
 */

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type {
  ProtocolMessage,
  Request,
  Response,
  Event,
} from "./protocol.js";

const HEADER_DELIMITER = "\r\n\r\n";
const CONTENT_LENGTH_HEADER = "Content-Length: ";

interface PendingRequest {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  command: string;
  timeout: NodeJS.Timeout;
}

export class DapTransport extends EventEmitter {
  private process: ChildProcess;
  private buffer: Buffer = Buffer.alloc(0);
  private pendingRequests: Map<number, PendingRequest> = new Map();
  private seq: number = 1;
  private requestTimeout: number;
  private closed: boolean = false;

  constructor(process: ChildProcess, requestTimeout: number = 30000) {
    super();
    this.process = process;
    this.requestTimeout = requestTimeout;

    if (!process.stdout || !process.stdin) {
      throw new Error("Process must have stdout and stdin");
    }

    process.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    process.stderr?.on("data", (chunk: Buffer) => {
      this.emit("stderr", chunk.toString());
    });

    process.on("exit", (code, signal) => {
      this.closed = true;
      this.rejectAllPending(
        new Error(`Debug adapter exited with code ${code}, signal ${signal}`)
      );
      this.emit("exit", code, signal);
    });

    process.on("error", (error) => {
      this.closed = true;
      this.rejectAllPending(error);
      this.emit("error", error);
    });
  }

  /**
   * Send a DAP request and wait for the response
   */
  async sendRequest<T>(command: string, args?: unknown): Promise<T> {
    if (this.closed) {
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
        reject(new Error(`Request '${command}' timed out after ${this.requestTimeout}ms`));
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
   * Close the transport and kill the process
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectAllPending(new Error("Transport closed"));
    this.process.kill();
  }

  /**
   * Check if the transport is still open
   */
  isOpen(): boolean {
    return !this.closed;
  }

  /**
   * Send a message to the debug adapter (used for reverse request responses)
   */
  send(message: ProtocolMessage): void {
    if (this.closed || !this.process.stdin?.writable) {
      return;
    }

    const json = JSON.stringify(message);
    const contentLength = Buffer.byteLength(json, "utf-8");
    const header = `${CONTENT_LENGTH_HEADER}${contentLength}${HEADER_DELIMITER}`;

    this.process.stdin.write(header + json);
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
    // Find header delimiter
    const headerEnd = this.buffer.indexOf(HEADER_DELIMITER);
    if (headerEnd === -1) return null;

    // Parse Content-Length header
    const headerStr = this.buffer.subarray(0, headerEnd).toString("utf-8");
    const match = headerStr.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      // Invalid header, skip to next potential header
      this.buffer = this.buffer.subarray(headerEnd + HEADER_DELIMITER.length);
      return null;
    }

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + HEADER_DELIMITER.length;
    const bodyEnd = bodyStart + contentLength;

    // Check if we have the full body
    if (this.buffer.length < bodyEnd) return null;

    // Extract and parse JSON body
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
    this.emit("message", message);

    switch (message.type) {
      case "response":
        this.handleResponse(message as Response);
        break;
      case "event":
        this.handleEvent(message as Event);
        break;
      case "request":
        // Reverse requests from adapter (e.g., runInTerminal, handshake)
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
