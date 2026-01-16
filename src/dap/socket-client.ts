/**
 * Socket-based DAP Client
 *
 * DAP client that connects to a debug adapter via TCP socket.
 * Used by adapters like js-debug that run as a socket server.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { SocketDapTransport } from "./socket-transport.js";
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

export interface SocketDapClientOptions {
  /** Command to spawn the debug adapter server */
  command: string;
  /** Arguments for the command (should include port) */
  args?: string[];
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Port to connect to */
  port: number;
  /** Host to connect to (default: localhost) */
  host?: string;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
  /** Delay before connecting (ms) - give server time to start */
  connectDelay?: number;
}

export class SocketDapClient extends EventEmitter {
  private transport: SocketDapTransport | null = null;
  private childTransport: SocketDapTransport | null = null;
  private process: ChildProcess | null = null;
  private options: SocketDapClientOptions;
  private capabilities: Capabilities = {};
  private initialized: boolean = false;
  
  // Store breakpoint configurations for child session
  private breakpointConfigs: SetBreakpointsArguments[] = [];
  private exceptionFilters: string[] = [];

  constructor(options: SocketDapClientOptions) {
    super();
    this.options = options;
  }

  /**
   * Start the debug adapter server and connect to it
   */
  async connect(): Promise<void> {
    if (this.transport) {
      throw new Error("Already connected");
    }

    // Spawn the DAP server process
    this.process = spawn(this.options.command, this.options.args || [], {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Forward stderr for debugging
    this.process.stderr?.on("data", (chunk: Buffer) => {
      this.emit("stderr", chunk.toString());
    });

    // Forward stdout (server may output useful info)
    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.emit("serverOutput", chunk.toString());
    });

    this.process.on("exit", (code, signal) => {
      this.emit("serverExit", code, signal);
    });

    this.process.on("error", (error) => {
      this.emit("serverError", error);
    });

    // Wait for server to start
    const delay = this.options.connectDelay ?? 1000;
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Connect to the socket
    // Use localhost to support both IPv4 and IPv6
    this.transport = new SocketDapTransport({
      host: this.options.host || "localhost",
      port: this.options.port,
      requestTimeout: this.options.timeout,
    });

    await this.transport.connect();

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

    // Handle reverse requests from js-debug
    this.transport.on("reverseRequest:startDebugging", async (request: { seq: number; arguments: { request: string; configuration: Record<string, unknown> } }) => {
      // js-debug asks us to start a child debug session
      // We need to create a new connection for the child session
      const childConfig = request.arguments?.configuration || {};
      
      if (process.env.DEBUG_DAP) {
        console.error("[DAP] Creating child session for js-debug");
        console.error("[DAP] Child config:", JSON.stringify(childConfig));
      }
      
      try {
        // Create child session on a new connection
        await this.createChildSession(childConfig);
        
        // Respond with success
        this.transport!.sendResponse(request.seq, "startDebugging", true);
        
        if (process.env.DEBUG_DAP) {
          console.error("[DAP] Child session created successfully");
        }
      } catch (error) {
        if (process.env.DEBUG_DAP) {
          console.error("[DAP] Child session creation failed:", error);
        }
        this.transport!.sendResponse(request.seq, "startDebugging", false, undefined, String(error));
      }
    });

    // Forward server output for debugging
    this.on("serverOutput", (data: string) => {
      if (process.env.DEBUG) {
        console.error("[js-debug server]", data);
      }
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
   * 
   * Note: Unlike stdio-based adapters, js-debug sends the 'initialized' event
   * after the launch request, not after initialize response. So we don't wait
   * for it here.
   */
  async initialize(args: Partial<InitializeRequestArguments> = {}): Promise<Capabilities> {
    this.ensureConnected();

    const response = await this.transport!.sendRequest<InitializeResponse>("initialize", {
      clientID: "vscode",
      clientName: "Visual Studio Code",
      adapterID: args.adapterID || "pwa-node",
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
    
    // Store breakpoint config for child session
    const existingIndex = this.breakpointConfigs.findIndex(
      bp => bp.source?.path === args.source?.path
    );
    if (existingIndex >= 0) {
      this.breakpointConfigs[existingIndex] = args;
    } else {
      this.breakpointConfigs.push(args);
    }
    
    return await this.transport!.sendRequest<SetBreakpointsResponse>("setBreakpoints", args);
  }

  /**
   * Set exception breakpoints
   */
  async setExceptionBreakpoints(args: SetExceptionBreakpointsArguments): Promise<void> {
    this.ensureInitialized();
    
    // Store exception filters for child session
    this.exceptionFilters = args.filters || [];
    
    await this.transport!.sendRequest("setExceptionBreakpoints", args);
  }

  /**
   * Get the active transport (child if exists, otherwise parent)
   */
  private getActiveTransport(): SocketDapTransport {
    // Use child transport for debugging operations if it exists
    if (this.childTransport?.isOpen()) {
      return this.childTransport;
    }
    return this.transport!;
  }

  /**
   * Get all threads
   */
  async threads(): Promise<ThreadsResponse> {
    this.ensureInitialized();
    return await this.getActiveTransport().sendRequest<ThreadsResponse>("threads");
  }

  /**
   * Get stack trace for a thread
   */
  async stackTrace(args: StackTraceArguments): Promise<StackTraceResponse> {
    this.ensureInitialized();
    return await this.getActiveTransport().sendRequest<StackTraceResponse>("stackTrace", args);
  }

  /**
   * Get scopes for a stack frame
   */
  async scopes(args: ScopesArguments): Promise<ScopesResponse> {
    this.ensureInitialized();
    return await this.getActiveTransport().sendRequest<ScopesResponse>("scopes", args);
  }

  /**
   * Get variables for a scope or variable reference
   */
  async variables(args: VariablesArguments): Promise<VariablesResponse> {
    this.ensureInitialized();
    return await this.getActiveTransport().sendRequest<VariablesResponse>("variables", args);
  }

  /**
   * Evaluate an expression
   */
  async evaluate(args: EvaluateArguments): Promise<EvaluateResponse> {
    this.ensureInitialized();
    return await this.getActiveTransport().sendRequest<EvaluateResponse>("evaluate", args);
  }

  /**
   * Continue execution
   */
  async continue(args: ContinueArguments): Promise<ContinueResponse> {
    this.ensureInitialized();
    return await this.getActiveTransport().sendRequest<ContinueResponse>("continue", args);
  }

  /**
   * Step over (next)
   */
  async next(args: NextArguments): Promise<void> {
    this.ensureInitialized();
    await this.getActiveTransport().sendRequest("next", args);
  }

  /**
   * Step into
   */
  async stepIn(args: StepInArguments): Promise<void> {
    this.ensureInitialized();
    await this.getActiveTransport().sendRequest("stepIn", args);
  }

  /**
   * Step out
   */
  async stepOut(args: StepOutArguments): Promise<void> {
    this.ensureInitialized();
    await this.getActiveTransport().sendRequest("stepOut", args);
  }

  /**
   * Pause execution
   */
  async pause(threadId: number): Promise<void> {
    this.ensureInitialized();
    await this.getActiveTransport().sendRequest("pause", { threadId });
  }

  /**
   * Disconnect from the debug session
   */
  async disconnect(terminateDebuggee: boolean = true, restart: boolean = false): Promise<void> {
    // Close child transport first
    if (this.childTransport?.isOpen()) {
      try {
        await this.childTransport.sendRequest("disconnect", {
          restart: false,
          terminateDebuggee,
        });
      } catch {
        // Ignore errors
      } finally {
        this.childTransport.close();
        this.childTransport = null;
      }
    }

    if (!this.transport?.isOpen()) return;

    try {
      await this.transport.sendRequest("disconnect", {
        restart,
        terminateDebuggee,
      });
    } catch {
      // Ignore errors during disconnect
    } finally {
      this.transport.close();
      // Kill the server process
      this.process?.kill();
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

  /**
   * Create a child debug session for js-debug's multi-session model
   */
  private async createChildSession(config: Record<string, unknown>): Promise<void> {
    // Create a new connection to js-debug for the child session
    this.childTransport = new SocketDapTransport({
      host: this.options.host || "localhost",
      port: this.options.port,
      requestTimeout: this.options.timeout,
    });

    await this.childTransport.connect();

    if (process.env.DEBUG_DAP) {
      console.error("[DAP child] Connected to js-debug");
    }

    // Forward events from child session to our main event emitter
    this.childTransport.on("event:stopped", (body: StoppedEventBody) => {
      if (process.env.DEBUG_DAP) {
        console.error("[DAP child] stopped event:", JSON.stringify(body));
      }
      this.emit("stopped", body);
    });

    this.childTransport.on("event:terminated", (body: TerminatedEventBody) => {
      if (process.env.DEBUG_DAP) {
        console.error("[DAP child] terminated event");
      }
      this.emit("terminated", body);
    });

    this.childTransport.on("event:exited", (body: ExitedEventBody) => {
      if (process.env.DEBUG_DAP) {
        console.error("[DAP child] exited event:", body?.exitCode);
      }
      this.emit("exited", body);
    });

    this.childTransport.on("event:output", (body: OutputEventBody) => {
      // Only forward non-telemetry output
      if (body?.category !== "telemetry") {
        this.emit("output", body);
      }
    });

    this.childTransport.on("event:breakpoint", (body: BreakpointEventBody) => {
      if (process.env.DEBUG_DAP) {
        console.error("[DAP child] breakpoint event:", JSON.stringify(body));
      }
      this.emit("breakpoint", body);
    });

    this.childTransport.on("event", (event: Event) => {
      if (process.env.DEBUG_DAP) {
        console.error("[DAP child] event:", event.event);
      }
    });

    // Initialize the child session
    await this.childTransport.sendRequest("initialize", {
      clientID: "vscode",
      clientName: "Visual Studio Code",
      adapterID: "pwa-node",
      pathFormat: "path",
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsVariablePaging: true,
      supportsRunInTerminalRequest: false,
      supportsStartDebuggingRequest: true,
    });

    if (process.env.DEBUG_DAP) {
      console.error("[DAP child] Initialize response received, waiting for initialized event...");
    }

    // Wait for the initialized event before setting breakpoints
    await new Promise<void>((resolve) => {
      let resolved = false;
      const onInitialized = () => {
        if (resolved) return;
        resolved = true;
        this.childTransport?.removeListener("event:initialized", onInitialized);
        resolve();
      };
      this.childTransport!.on("event:initialized", onInitialized);
      
      // Also set a timeout in case initialized was already sent
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        this.childTransport?.removeListener("event:initialized", onInitialized);
        resolve();
      }, 500);
    });

    if (process.env.DEBUG_DAP) {
      console.error("[DAP child] Initialized");
    }

    // Re-set breakpoints on child session
    for (const bp of this.breakpointConfigs) {
      if (process.env.DEBUG_DAP) {
        console.error("[DAP child] Setting breakpoints for:", bp.source?.path);
      }
      const response = await this.childTransport.sendRequest<SetBreakpointsResponse>("setBreakpoints", bp);
      if (process.env.DEBUG_DAP) {
        console.error("[DAP child] Breakpoint response:", JSON.stringify(response, null, 2));
      }
    }

    // Re-set exception breakpoints if any
    if (this.exceptionFilters.length > 0) {
      await this.childTransport.sendRequest("setExceptionBreakpoints", {
        filters: this.exceptionFilters,
      });
    }

    // Configuration done
    await this.childTransport.sendRequest("configurationDone");

    if (process.env.DEBUG_DAP) {
      console.error("[DAP child] Configuration done, launching with pendingTargetId");
    }

    // Launch with the child configuration (includes __pendingTargetId)
    await this.childTransport.sendRequest("launch", {
      type: "pwa-node",
      request: "launch",
      ...config,
    });

    if (process.env.DEBUG_DAP) {
      console.error("[DAP child] Launch complete");
    }
  }
}
