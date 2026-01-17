/**
 * DAP Client
 *
 * High-level client wrapping the transport layer with typed DAP methods.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { DapTransport } from './transport.js';
import { signHandshake } from '../util/vsda-signer.js';
import type {
  Request,
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
} from './protocol.js';

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
      throw new Error('Already connected');
    }

    this.process = spawn(this.options.command, this.options.args || [], {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.transport = new DapTransport(this.process, this.options.timeout);

    // Forward events
    this.transport.on('event:stopped', (body: StoppedEventBody) => {
      this.emit('stopped', body);
    });

    this.transport.on('event:terminated', (body: TerminatedEventBody) => {
      this.emit('terminated', body);
    });

    this.transport.on('event:exited', (body: ExitedEventBody) => {
      this.emit('exited', body);
    });

    this.transport.on('event:output', (body: OutputEventBody) => {
      this.emit('output', body);
    });

    this.transport.on('event:breakpoint', (body: BreakpointEventBody) => {
      this.emit('breakpoint', body);
    });

    this.transport.on('event:initialized', () => {
      this.emit('initialized');
    });

    this.transport.on('event', (event: Event) => {
      this.emit('event', event);
    });

    this.transport.on('stderr', (data: string) => {
      this.emit('stderr', data);
    });

    this.transport.on('exit', (code: number | null, signal: string | null) => {
      this.emit('exit', code, signal);
    });

    this.transport.on('error', (error: Error) => {
      this.emit('error', error);
    });

    // Handle vsdbg handshake reverse request
    this.transport.on('reverseRequest:handshake', (request: Request) => {
      this.handleHandshakeRequest(request);
    });
  }

  /**
   * Handle vsdbg handshake authentication request
   */
  private handleHandshakeRequest(request: Request): void {
    const args = request.arguments as { value?: string } | undefined;
    const challenge = args?.value;

    if (!challenge) {
      this.sendReverseResponse(request, false, 'No challenge value provided');
      return;
    }

    const signature = signHandshake(challenge);
    if (signature) {
      this.sendReverseResponse(request, true, undefined, { signature });
    } else {
      // If we can't sign, send empty response - vsdbg may still work
      this.sendReverseResponse(request, true, undefined, { signature: '' });
    }
  }

  /**
   * Send a response to a reverse request from the adapter
   */
  private sendReverseResponse(
    request: Request,
    success: boolean,
    message?: string,
    body?: unknown
  ): void {
    if (!this.transport) return;

    const response = {
      seq: 0, // Will be set by transport
      type: 'response' as const,
      request_seq: request.seq,
      command: request.command,
      success,
      message,
      body,
    };

    this.transport.send(response);
  }

  /**
   * Initialize the debug session
   *
   * After the initialize response, waits for the 'initialized' event from the adapter
   * before returning, as required by the DAP protocol.
   */
  async initialize(args: Partial<InitializeRequestArguments> = {}): Promise<Capabilities> {
    this.ensureConnected();

    // Set up listener for initialized event BEFORE sending request
    // (the event may arrive immediately after the response)
    let initializedResolve: () => void;
    const initializedPromise = new Promise<void>((resolve) => {
      initializedResolve = resolve;
    });
    this.once('initialized', () => initializedResolve());

    const response = await this.transport!.sendRequest<InitializeResponse>('initialize', {
      // Use VS Code identity for vsdbg compatibility
      clientID: 'vscode',
      clientName: 'Visual Studio Code',
      adapterID: args.adapterID || 'unknown',
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsVariablePaging: true,
      supportsRunInTerminalRequest: false,
      ...args,
    });

    this.capabilities = response?.capabilities || response || {};

    // Wait for the initialized event (with a timeout to handle adapters that don't send it)
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Timeout waiting for initialized event')), 10000);
    });

    try {
      await Promise.race([initializedPromise, timeoutPromise]);
    } catch {
      // Some adapters may not send initialized event, continue anyway
    }

    this.initialized = true;
    return this.capabilities;
  }

  /**
   * Launch a program to debug
   */
  async launch(args: LaunchRequestArguments): Promise<void> {
    this.ensureInitialized();
    await this.transport!.sendRequest('launch', args);
  }

  /**
   * Attach to a running process
   */
  async attach(args: AttachRequestArguments): Promise<void> {
    this.ensureInitialized();
    await this.transport!.sendRequest('attach', args);
  }

  /**
   * Signal that configuration is done
   */
  async configurationDone(): Promise<void> {
    this.ensureInitialized();
    await this.transport!.sendRequest('configurationDone');
  }

  /**
   * Set breakpoints for a source file
   */
  async setBreakpoints(args: SetBreakpointsArguments): Promise<SetBreakpointsResponse> {
    this.ensureInitialized();
    return await this.transport!.sendRequest<SetBreakpointsResponse>('setBreakpoints', args);
  }

  /**
   * Set exception breakpoints
   */
  async setExceptionBreakpoints(args: SetExceptionBreakpointsArguments): Promise<void> {
    this.ensureInitialized();
    await this.transport!.sendRequest('setExceptionBreakpoints', args);
  }

  /**
   * Get all threads
   */
  async threads(): Promise<ThreadsResponse> {
    this.ensureInitialized();
    return await this.transport!.sendRequest<ThreadsResponse>('threads');
  }

  /**
   * Get stack trace for a thread
   */
  async stackTrace(args: StackTraceArguments): Promise<StackTraceResponse> {
    this.ensureInitialized();
    return await this.transport!.sendRequest<StackTraceResponse>('stackTrace', args);
  }

  /**
   * Get scopes for a stack frame
   */
  async scopes(args: ScopesArguments): Promise<ScopesResponse> {
    this.ensureInitialized();
    return await this.transport!.sendRequest<ScopesResponse>('scopes', args);
  }

  /**
   * Get variables for a scope or variable reference
   */
  async variables(args: VariablesArguments): Promise<VariablesResponse> {
    this.ensureInitialized();
    return await this.transport!.sendRequest<VariablesResponse>('variables', args);
  }

  /**
   * Evaluate an expression
   */
  async evaluate(args: EvaluateArguments): Promise<EvaluateResponse> {
    this.ensureInitialized();
    return await this.transport!.sendRequest<EvaluateResponse>('evaluate', args);
  }

  /**
   * Continue execution
   */
  async continue(args: ContinueArguments): Promise<ContinueResponse> {
    this.ensureInitialized();
    return await this.transport!.sendRequest<ContinueResponse>('continue', args);
  }

  /**
   * Step over (next)
   */
  async next(args: NextArguments): Promise<void> {
    this.ensureInitialized();
    await this.transport!.sendRequest('next', args);
  }

  /**
   * Step into
   */
  async stepIn(args: StepInArguments): Promise<void> {
    this.ensureInitialized();
    await this.transport!.sendRequest('stepIn', args);
  }

  /**
   * Step out
   */
  async stepOut(args: StepOutArguments): Promise<void> {
    this.ensureInitialized();
    await this.transport!.sendRequest('stepOut', args);
  }

  /**
   * Pause execution
   */
  async pause(threadId: number): Promise<void> {
    this.ensureInitialized();
    await this.transport!.sendRequest('pause', { threadId });
  }

  /**
   * Disconnect from the debug session
   * @param terminateDebuggee - If true, the debuggee process will be terminated.
   *                           For attach mode, this should be false to leave the process running.
   * @param restart - If true, request the debug adapter to restart the session.
   */
  async disconnect(terminateDebuggee: boolean = true, restart: boolean = false): Promise<void> {
    if (!this.transport?.isOpen()) return;

    try {
      await this.transport.sendRequest('disconnect', {
        restart,
        terminateDebuggee,
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
      await this.transport.sendRequest('terminate');
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
      throw new Error('Not connected. Call connect() first.');
    }
  }

  private ensureInitialized(): void {
    this.ensureConnected();
    if (!this.initialized) {
      throw new Error('Not initialized. Call initialize() first.');
    }
  }
}
