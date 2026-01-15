/**
 * Debug Session Manager
 *
 * Orchestrates the debug session lifecycle:
 * - Spawns debug adapter
 * - Initializes DAP session
 * - Sets breakpoints
 * - Handles stopped events
 * - Captures variables and evaluations
 * - Manages session cleanup
 */

import type { AdapterConfig } from "../adapters/base.js";
import { DapClient } from "../dap/client.js";
import type { StoppedEventBody, ExitedEventBody, OutputEventBody } from "../dap/protocol.js";
import { OutputFormatter } from "../output/formatter.js";
import type {
  SourceLocation,
  StackFrameInfo,
  VariableValue,
  BreakpointHitEvent,
  ExceptionThrownEvent,
} from "../output/events.js";
import { BreakpointManager } from "./breakpoints.js";
import { VariableInspector } from "./variables.js";

export interface SessionConfig {
  adapter: AdapterConfig;
  program: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  breakpoints: string[];
  logpoints?: string[];
  exceptionFilters?: string[];
  evaluations?: string[];
  timeout?: number;
  captureLocals?: boolean;
}

type SessionState =
  | "created"
  | "connecting"
  | "initializing"
  | "configuring"
  | "running"
  | "stopped"
  | "terminated";

export class DebugSession {
  private config: SessionConfig;
  private client: DapClient | null = null;
  private formatter: OutputFormatter;
  private breakpointManager: BreakpointManager | null = null;
  private variableInspector: VariableInspector | null = null;

  private state: SessionState = "created";
  private startTime: number = 0;
  private exitCode: number | null = null;
  private breakpointsHit: number = 0;
  private exceptionsCaught: number = 0;
  private stepsExecuted: number = 0;

  private sessionPromise: Promise<void> | null = null;
  private sessionResolve: (() => void) | null = null;
  private _sessionReject: ((error: Error) => void) | null = null;
  private timeoutHandle: NodeJS.Timeout | null = null;

  constructor(config: SessionConfig, formatter?: OutputFormatter) {
    this.config = config;
    this.formatter = formatter ?? new OutputFormatter();
  }

  /**
   * Run the debug session
   */
  async run(): Promise<void> {
    this.startTime = Date.now();

    // Emit session start
    this.formatter.sessionStart(
      this.config.adapter.name,
      this.config.program,
      this.config.args,
      this.config.cwd
    );

    // Create promise to track session completion
    this.sessionPromise = new Promise((resolve, reject) => {
      this.sessionResolve = resolve;
      this._sessionReject = reject;
    });

    // Set up timeout
    if (this.config.timeout) {
      this.timeoutHandle = setTimeout(() => {
        this.handleTimeout();
      }, this.config.timeout);
    }

    try {
      await this.start();
      await this.sessionPromise;
    } catch (error) {
      this.formatter.error(
        "Session failed",
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  private async start(): Promise<void> {
    // Create and connect DAP client
    this.state = "connecting";
    this.client = new DapClient({
      command: this.config.adapter.command,
      args: this.config.adapter.args,
      cwd: this.config.cwd,
      env: this.config.env,
      timeout: this.config.timeout,
    });

    this.setupEventHandlers();
    await this.client.connect();

    // Initialize DAP session
    this.state = "initializing";
    await this.client.initialize({
      adapterID: this.config.adapter.id,
    });

    // Create managers
    this.breakpointManager = new BreakpointManager(this.client, this.formatter);
    this.variableInspector = new VariableInspector(this.client);

    // Add breakpoints
    for (const bp of this.config.breakpoints) {
      this.breakpointManager.addBreakpoint(bp);
    }

    // Add logpoints
    if (this.config.logpoints) {
      for (const lp of this.config.logpoints) {
        this.breakpointManager.addLogpoint(lp);
      }
    }

    // Set breakpoints and logpoints
    this.state = "configuring";
    await this.breakpointManager.setAllBreakpoints();

    // Set exception breakpoints
    if (this.config.exceptionFilters && this.config.exceptionFilters.length > 0) {
      await this.client.setExceptionBreakpoints({
        filters: this.config.exceptionFilters,
      });
      this.formatter.emit(
        this.formatter.createEvent("exception_breakpoint_set", {
          filters: this.config.exceptionFilters,
        })
      );
    }

    // Launch the program
    const launchConfig = this.config.adapter.launchConfig({
      program: this.config.program,
      args: this.config.args,
      cwd: this.config.cwd,
      env: this.config.env,
    });

    await this.client.launch(launchConfig);

    // Signal configuration done
    await this.client.configurationDone();

    this.state = "running";
    this.formatter.emit(
      this.formatter.createEvent("process_launched", {})
    );
  }

  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.on("stopped", async (body: StoppedEventBody) => {
      await this.handleStopped(body);
    });

    this.client.on("exited", (body: ExitedEventBody) => {
      this.handleExited(body);
    });

    this.client.on("terminated", () => {
      this.handleTerminated();
    });

    this.client.on("output", (body: OutputEventBody) => {
      this.handleOutput(body);
    });

    this.client.on("error", (error: Error) => {
      this.formatter.error("Debug adapter error", error.message);
    });

    this.client.on("exit", () => {
      this.handleAdapterExit();
    });
  }

  private async handleStopped(body: StoppedEventBody): Promise<void> {
    this.state = "stopped";
    const threadId = body.threadId ?? 1;
    const reason = body.reason;

    try {
      // Get stack trace
      const stackResponse = await this.client!.stackTrace({
        threadId,
        levels: 20,
      });

      const stackTrace: StackFrameInfo[] = stackResponse.stackFrames.map((frame) => ({
        frameId: frame.id,
        function: frame.name,
        file: frame.source?.path ?? null,
        line: frame.line ?? null,
        column: frame.column ?? null,
        module: frame.source?.name,
      }));

      const topFrame = stackResponse.stackFrames[0];
      const location: SourceLocation = {
        file: topFrame?.source?.path ?? "unknown",
        line: topFrame?.line ?? 0,
        column: topFrame?.column,
        function: topFrame?.name,
        module: topFrame?.source?.name,
      };

      // Get locals if requested
      let locals: Record<string, VariableValue> = {};
      if (this.config.captureLocals !== false && topFrame) {
        locals = await this.variableInspector!.getLocals(topFrame.id);
      }

      // Run evaluations if specified
      let evaluations: Record<string, { result: string; type?: string; error?: string }> | undefined;
      if (this.config.evaluations?.length && topFrame) {
        evaluations = await this.variableInspector!.evaluateExpressions(
          topFrame.id,
          this.config.evaluations
        );
      }

      // Emit appropriate event
      if (reason === "exception") {
        this.exceptionsCaught++;

        const event: ExceptionThrownEvent = {
          type: "exception_thrown",
          timestamp: new Date().toISOString(),
          threadId,
          exception: {
            type: body.text ?? "Exception",
            message: body.description ?? "Unknown exception",
          },
          location,
          locals,
        };
        this.formatter.emit(event);
      } else {
        if (reason === "breakpoint") {
          this.breakpointsHit++;
        }

        const event: BreakpointHitEvent = {
          type: "breakpoint_hit",
          timestamp: new Date().toISOString(),
          id: body.hitBreakpointIds?.[0],
          threadId,
          location,
          stackTrace,
          locals,
          evaluations,
        };
        this.formatter.emit(event);
      }

      // Continue execution after capturing state
      await this.client!.continue({ threadId });
      this.state = "running";
    } catch (error) {
      this.formatter.error(
        "Failed to handle stopped event",
        error instanceof Error ? error.message : String(error)
      );

      // Try to continue anyway
      try {
        await this.client!.continue({ threadId });
      } catch {
        // Session might be ending
      }
    }
  }

  private handleExited(body: ExitedEventBody): void {
    this.exitCode = body.exitCode;
    this.formatter.emit(
      this.formatter.createEvent("process_exited", {
        exitCode: body.exitCode,
        durationMs: Date.now() - this.startTime,
      })
    );
  }

  private handleTerminated(): void {
    this.state = "terminated";
    this.endSession();
  }

  private handleOutput(body: OutputEventBody): void {
    if (body.category === "stdout" || body.category === "stderr" || body.category === "console") {
      this.formatter.programOutput(body.category, body.output);
    }
  }

  private handleAdapterExit(): void {
    if (this.state !== "terminated") {
      this.state = "terminated";
      this.endSession();
    }
  }

  private handleTimeout(): void {
    this.formatter.error("Session timed out", `Timeout after ${this.config.timeout}ms`);
    this.endSessionWithError(new Error(`Session timed out after ${this.config.timeout}ms`));
  }

  private endSessionWithError(error: Error): void {
    // Emit session end
    this.formatter.sessionEnd({
      durationMs: Date.now() - this.startTime,
      exitCode: this.exitCode,
      breakpointsHit: this.breakpointsHit,
      exceptionsCaught: this.exceptionsCaught,
      stepsExecuted: this.stepsExecuted,
    });

    // Reject the session promise
    if (this._sessionReject) {
      this._sessionReject(error);
      this.sessionResolve = null;
      this._sessionReject = null;
    }
  }

  private endSession(): void {
    // Emit session end
    this.formatter.sessionEnd({
      durationMs: Date.now() - this.startTime,
      exitCode: this.exitCode,
      breakpointsHit: this.breakpointsHit,
      exceptionsCaught: this.exceptionsCaught,
      stepsExecuted: this.stepsExecuted,
    });

    // Resolve the session promise
    if (this.sessionResolve) {
      this.sessionResolve();
      this.sessionResolve = null;
      this._sessionReject = null;
    }
  }

  private async cleanup(): Promise<void> {
    // Clear timeout
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }

    // Disconnect client
    if (this.client?.isConnected()) {
      try {
        await this.client.disconnect();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
