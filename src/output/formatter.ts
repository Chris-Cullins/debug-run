/**
 * Output Formatter
 *
 * Serializes debug events to NDJSON for agent consumption.
 */

import type { DebugEvent } from "./events.js";

export interface FormatterOptions {
  /** Write to a custom stream (default: stdout) */
  stream?: NodeJS.WritableStream;
  /** Pretty print JSON (default: false) */
  pretty?: boolean;
}

export class OutputFormatter {
  private stream: NodeJS.WritableStream;
  private pretty: boolean;

  constructor(options: FormatterOptions = {}) {
    this.stream = options.stream ?? process.stdout;
    this.pretty = options.pretty ?? false;
  }

  /**
   * Emit a debug event
   */
  emit(event: DebugEvent): void {
    const json = this.pretty
      ? JSON.stringify(event, null, 2)
      : JSON.stringify(event);

    this.stream.write(json + "\n");
  }

  /**
   * Create an event with timestamp
   */
  createEvent<T extends DebugEvent["type"]>(
    type: T,
    data: Omit<Extract<DebugEvent, { type: T }>, "type" | "timestamp">
  ): Extract<DebugEvent, { type: T }> {
    return {
      type,
      timestamp: new Date().toISOString(),
      ...data,
    } as Extract<DebugEvent, { type: T }>;
  }

  /**
   * Emit a session_start event
   */
  sessionStart(adapter: string, program: string, args?: string[], cwd?: string): void {
    this.emit(
      this.createEvent("session_start", {
        adapter,
        program,
        args,
        cwd,
      })
    );
  }

  /**
   * Emit a session_end event
   */
  sessionEnd(summary: {
    durationMs: number;
    exitCode: number | null;
    breakpointsHit: number;
    exceptionsCaught: number;
    stepsExecuted: number;
  }): void {
    this.emit(this.createEvent("session_end", { summary }));
  }

  /**
   * Emit a breakpoint_set event
   */
  breakpointSet(
    id: number,
    file: string,
    line: number,
    verified: boolean,
    condition?: string,
    message?: string
  ): void {
    this.emit(
      this.createEvent("breakpoint_set", {
        id,
        file,
        line,
        verified,
        condition,
        message,
      })
    );
  }

  /**
   * Emit an error event
   */
  error(message: string, details?: string): void {
    this.emit(this.createEvent("error", { message, details }));
  }

  /**
   * Emit a program_output event
   */
  programOutput(category: "stdout" | "stderr" | "console", output: string): void {
    this.emit(this.createEvent("program_output", { category, output }));
  }
}
