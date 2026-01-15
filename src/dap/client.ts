/**
 * DAP Client
 *
 * High-level client wrapping the transport layer with typed DAP methods.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { DapTransport } from "./transport.js";
import type {
  InitializeRequestArguments,
  InitializeResponse,
  LaunchRequestArguments,
  AttachRequestArguments,
  SetBreakpointsArguments,
  SetBreakpointsResponse,
  SetExceptionBreakpointsArguments,
  StackTraceArguments,
  StackTraceResponse,
  ScopesArguments,
  ScopesResponse,
  VariablesArguments,
  VariablesResponse,
  EvaluateArguments,
  EvaluateResponse,
  ThreadsResponse,
  ContinueArguments,
  ContinueResponse,
  NextArguments,
  StepInArguments,
  StepOutArguments,
  Capabilities,
  StoppedEventBody,
  TerminatedEventBody,
  ExitedEventBody,
  OutputEventBody,
  BreakpointEventBody,
  Event,
} from "./protocol.js";

export interface DapClientOptions {
  /** Command to spawn the debug adapter */
  command: string;
  /** Arguments for the command */
  args?: string[];
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}

export class DapClient extends EventEmitter {
  private transport: DapTransport | null = null;
  private process: ChildProcess | null = null;
  private options: DapClientOptions;
  private capabilities: Capabilities = {};
  private initialized: boolean = false;

  constructor(options: DapClientOptions) {
    super();
    this.options = options;
  }

  /**
   * Spawn the debug adapter process and establish communication
   */
  async connect(): Promise<void> {
    if (this.transport) {
      throw new Error("Already connected");
    }

    this.process = spawn(this.options.command, this.options.args || [], {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.transport = new DapTransport(this.process, this.options.timeout);

    // Forward events
    this.transport.on("event:stopped", (body: StoppedEventBody) => {
      this.emit("stopped", body);
    });

    this.transport.on("event:terminated", (body: TerminatedEventBody) => {
      this.emit("terminated", body);
    });

    this.transport.on("event:exited", (body: ExitedEventBody) => {
      this.emit("exited", body);
    });

    this.transport.on("event:output", (body: OutputEventBody) => {
      this.emit("output", body);
    });

    this.transport.on("event:breakpoint", (body: BreakpointEventBody) => {
      this.emit("breakpoint", body);
    });

    this.transport.on("event:initialized", () => {
      this.emit("initialized");
    });

    this.transport.on("event", (event: Event) => {
      this.emit("event", event);
    });

    this.transport.on("stderr", (data: string) => {
      this.emit("stderr", data);
    });

    this.transport.on("exit", (code: number | null, signal: string | null) => {
      this.emit("exit", code, signal);
    });

    this.transport.on("error", (error: Error) => {
      this.emit("error", error);
    });
  }

  /**
   * Initialize the debug session
   */
  async initialize(args: Partial<InitializeRequestArguments> = {}): Promise<Capabilities> {
    this.ensureConnected();

    const response = await this.transport!.sendRequest<InitializeResponse>("initialize", {
      clientID: "debug-run",
      clientName: "debug-run",
      adapterID: args.adapterID || "unknown",
      pathFormat: "path",
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsVariablePaging: true,
      supportsRunInTerminalRequest: false,
      ...args,
    });

    this.capabilities = response?.capabilities || response || {};
    this.initialized = true;
    return this.capabilities;
  }

  /**
   * Launch a program to debug
   */
  async launch(args: LaunchRequestArguments): Promise<void> {
    this.ensureInitialized();
    await this.transport!.sendRequest("launch", args);
  }

  /**
   * Attach to a running process
   */
  async attach(args: AttachRequestArguments): Promise<void> {
    this.ensureInitialized();
    await this.transport!.sendRequest("attach", args);
  }

  /**
   * Signal that configuration is done
   */
  async configurationDone(): Promise<void> {
    this.ensureInitialized();
    await this.transport!.sendRequest("configurationDone");
  }

  /**
   * Set breakpoints for a source file
   */
  async setBreakpoints(args: SetBreakpointsArguments): Promise<SetBreakpointsResponse> {
    this.ensureInitialized();
    return await this.transport!.sendRequest<SetBreakpointsResponse>("setBreakpoints", args);
  }

  /**
   * Set exception breakpoints
   */
  async setExceptionBreakpoints(args: SetExceptionBreakpointsArguments): Promise<void> {
    this.ensureInitialized();
    await this.transport!.sendRequest("setExceptionBreakpoints", args);
  }

  /**
   * Get all threads
   */
  async threads(): Promise<ThreadsResponse> {
    this.ensureInitialized();
    return await this.transport!.sendRequest<ThreadsResponse>("threads");
  }

  /**
   * Get stack trace for a thread
   */
  async stackTrace(args: StackTraceArguments): Promise<StackTraceResponse> {
    this.ensureInitialized();
    return await this.transport!.sendRequest<StackTraceResponse>("stackTrace", args);
  }

  /**
   * Get scopes for a stack frame
   */
  async scopes(args: ScopesArguments): Promise<ScopesResponse> {
    this.ensureInitialized();
    return await this.transport!.sendRequest<ScopesResponse>("scopes", args);
  }

  /**
   * Get variables for a scope or variable reference
   */
  async variables(args: VariablesArguments): Promise<VariablesResponse> {
    this.ensureInitialized();
    return await this.transport!.sendRequest<VariablesResponse>("variables", args);
  }

  /**
   * Evaluate an expression
   */
  async evaluate(args: EvaluateArguments): Promise<EvaluateResponse> {
    this.ensureInitialized();
    return await this.transport!.sendRequest<EvaluateResponse>("evaluate", args);
  }

  /**
   * Continue execution
   */
  async continue(args: ContinueArguments): Promise<ContinueResponse> {
    this.ensureInitialized();
    return await this.transport!.sendRequest<ContinueResponse>("continue", args);
  }

  /**
   * Step over (next)
   */
  async next(args: NextArguments): Promise<void> {
    this.ensureInitialized();
    await this.transport!.sendRequest("next", args);
  }

  /**
   * Step into
   */
  async stepIn(args: StepInArguments): Promise<void> {
    this.ensureInitialized();
    await this.transport!.sendRequest("stepIn", args);
  }

  /**
   * Step out
   */
  async stepOut(args: StepOutArguments): Promise<void> {
    this.ensureInitialized();
    await this.transport!.sendRequest("stepOut", args);
  }

  /**
   * Pause execution
   */
  async pause(threadId: number): Promise<void> {
    this.ensureInitialized();
    await this.transport!.sendRequest("pause", { threadId });
  }

  /**
   * Disconnect from the debug session
   */
  async disconnect(restart: boolean = false): Promise<void> {
    if (!this.transport?.isOpen()) return;

    try {
      await this.transport.sendRequest("disconnect", {
        restart,
        terminateDebuggee: true,
      });
    } catch {
      // Ignore errors during disconnect
    } finally {
      this.transport.close();
    }
  }

  /**
   * Terminate the debuggee
   */
  async terminate(): Promise<void> {
    if (!this.transport?.isOpen()) return;

    try {
      await this.transport.sendRequest("terminate");
    } catch {
      // Ignore errors during terminate
    }
  }

  /**
   * Get the debug adapter capabilities
   */
  getCapabilities(): Capabilities {
    return this.capabilities;
  }

  /**
   * Check if the client is connected
   */
  isConnected(): boolean {
    return this.transport?.isOpen() ?? false;
  }

  private ensureConnected(): void {
    if (!this.transport) {
      throw new Error("Not connected. Call connect() first.");
    }
  }

  private ensureInitialized(): void {
    this.ensureConnected();
    if (!this.initialized) {
      throw new Error("Not initialized. Call initialize() first.");
    }
  }
}
