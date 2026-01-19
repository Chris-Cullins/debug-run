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

import type { AdapterConfig } from '../adapters/base.js';
import { DapClient } from '../dap/client.js';
import { SocketDapClient } from '../dap/socket-client.js';
import type { IDapClient } from '../dap/client-interface.js';
import type { StoppedEventBody, ExitedEventBody, OutputEventBody } from '../dap/protocol.js';
import { OutputFormatter } from '../output/formatter.js';
import type {
  SourceLocation,
  StackFrameInfo,
  VariableValue,
  BreakpointHitEvent,
  ExceptionThrownEvent,
  StepCompletedEvent,
  TraceStartedEvent,
  TraceStepEvent,
  TraceCompletedEvent,
  TraceStopReason,
  AssertionFailedEvent,
} from '../output/events.js';
import { BreakpointManager } from './breakpoints.js';
import { VariableInspector } from './variables.js';
import { flattenExceptionChainFromLocals } from './exceptions.js';

export interface SessionConfig {
  adapter: AdapterConfig;
  program?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  breakpoints: string[];
  logpoints?: string[];
  exceptionFilters?: string[];
  evaluations?: string[];
  assertions?: string[];
  timeout?: number;
  captureLocals?: boolean;
  /** Number of steps to execute after hitting a breakpoint */
  steps?: number;
  /** Whether to capture variables at each step */
  captureEachStep?: boolean;
  /** Attach to a running process instead of launching */
  attach?: boolean;
  /** Process ID to attach to */
  pid?: number;
  /** Enable trace mode - step through code after breakpoint hit */
  trace?: boolean;
  /** Use stepIn instead of stepOver in trace mode */
  traceInto?: boolean;
  /** Maximum steps in trace mode before stopping (default: 500) */
  traceLimit?: number;
  /** Stop trace when this expression evaluates to truthy */
  traceUntil?: string;
  /** Show only changed variables in trace steps instead of full dumps */
  diffVars?: boolean;
  /** Step once before evaluating expressions (for variables assigned on breakpoint line) */
  evalAfterStep?: boolean;
  // Token efficiency options
  /** Fully expand service-like types instead of compact form (default: false) */
  expandServices?: boolean;
  /** Include null properties in output (default: false) */
  showNullProps?: boolean;
  /** Disable content-based deduplication (default: false) */
  noDedupe?: boolean;
  // Exception handling options
  /** Flatten exception chains and classify root causes (default: true) */
  flattenExceptions?: boolean;
  /** Maximum depth to traverse exception chain (default: 10) */
  exceptionChainDepth?: number;
}

type SessionState =
  | 'created'
  | 'connecting'
  | 'initializing'
  | 'configuring'
  | 'running'
  | 'stopped'
  | 'terminated';

export class DebugSession {
  private config: SessionConfig;
  private client: IDapClient | null = null;
  private formatter: OutputFormatter;
  private breakpointManager: BreakpointManager | null = null;
  private variableInspector: VariableInspector | null = null;

  private state: SessionState = 'created';
  private startTime: number = 0;
  private exitCode: number | null = null;
  private breakpointsHit: number = 0;
  private exceptionsCaught: number = 0;
  private stepsExecuted: number = 0;

  /** Remaining steps to execute after the current breakpoint */
  private remainingSteps: number = 0;
  /** Whether we are currently in stepping mode */
  private isStepping: boolean = false;

  /** Whether we are currently in trace mode */
  private isTracing: boolean = false;
  /** Number of steps executed in current trace */
  private traceStepCount: number = 0;
  /** Path of locations visited during trace */
  private tracePath: SourceLocation[] = [];
  /** Initial stack depth when trace started (to detect function return) */
  private traceInitialStackDepth: number = 0;
  /** Previous locals for variable diffing (only used when diffVars is enabled) */
  private previousLocals: Record<string, VariableValue> = {};
  /** Whether we are stepping to evaluate expressions after line execution */
  private isEvalAfterStep: boolean = false;
  /** Pending data for eval-after-step (original breakpoint data) */
  private evalAfterStepData: {
    threadId: number;
    originalLocation: SourceLocation;
    originalStackTrace: StackFrameInfo[];
    breakpointId?: number;
  } | null = null;

  private sessionPromise: Promise<void> | null = null;
  private sessionResolve: (() => void) | null = null;
  private timeoutHandle: NodeJS.Timeout | null = null;
  /** Error that occurred during session (timeout, etc.) - used to avoid unhandled promise rejections */
  private sessionError: Error | null = null;
  /** Whether session_end event has been emitted (to prevent duplicate emissions) */
  private sessionEndEmitted: boolean = false;

  constructor(config: SessionConfig, formatter?: OutputFormatter) {
    this.config = config;
    this.formatter = formatter ?? new OutputFormatter();
  }

  /**
   * Run the debug session
   */
  async run(): Promise<void> {
    this.startTime = Date.now();
    this.sessionError = null;
    this.sessionEndEmitted = false;

    // Emit session start
    if (this.config.attach && this.config.pid) {
      this.formatter.sessionStartAttach(this.config.adapter.name, this.config.pid);
    } else {
      this.formatter.sessionStart(
        this.config.adapter.name,
        this.config.program!,
        this.config.args,
        this.config.cwd
      );
    }

    // Create promise to track session completion
    // Note: This promise always resolves (never rejects) to avoid unhandled promise rejections
    // when timeout fires during start(). Errors are stored in sessionError instead.
    this.sessionPromise = new Promise((resolve) => {
      this.sessionResolve = resolve;
    });

    // Set up timeout
    if (this.config.timeout) {
      this.timeoutHandle = setTimeout(() => {
        this.handleTimeout();
      }, this.config.timeout);
    }

    try {
      // Race start() against sessionPromise to handle timeout during startup.
      // If timeout fires while we're in start(), sessionPromise resolves and we exit the race.
      await Promise.race([this.start(), this.sessionPromise]);

      // Check if timeout fired during start()
      if (this.sessionError) {
        throw this.sessionError;
      }

      // Wait for session to complete normally
      await this.sessionPromise;

      // Check if session ended with error (e.g., timeout)
      if (this.sessionError) {
        throw this.sessionError;
      }
    } catch (error) {
      // Only emit error if it wasn't already emitted by endSessionWithError
      if (error !== this.sessionError) {
        this.formatter.error(
          'Session failed',
          error instanceof Error ? error.message : String(error)
        );
      }
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  private async start(): Promise<void> {
    // Create and connect DAP client
    this.state = 'connecting';

    if (this.config.adapter.transport === 'socket' && this.config.adapter.socketPort) {
      // Use socket-based client for adapters like js-debug
      this.client = new SocketDapClient({
        command: this.config.adapter.command,
        args: this.config.adapter.args,
        cwd: this.config.cwd,
        env: { ...this.config.adapter.env, ...this.config.env },
        port: this.config.adapter.socketPort,
        timeout: this.config.timeout,
      });
    } else {
      // Use stdio-based client (default)
      this.client = new DapClient({
        command: this.config.adapter.command,
        args: this.config.adapter.args,
        cwd: this.config.cwd,
        env: { ...this.config.adapter.env, ...this.config.env },
        timeout: this.config.timeout,
      });
    }

    this.setupEventHandlers();
    await this.client.connect();

    // Initialize DAP session
    this.state = 'initializing';
    await this.client.initialize({
      adapterID: this.config.adapter.id,
    });

    // Create managers
    this.breakpointManager = new BreakpointManager(this.client, this.formatter, {
      cwd: this.config.cwd,
      programPath: this.config.program,
      adapterType: this.config.adapter.name,
    });
    this.variableInspector = new VariableInspector(this.client, {
      compactServices: !this.config.expandServices,
      omitNullProperties: !this.config.showNullProps,
      deduplicateByContent: !this.config.noDedupe,
    });

    // Add breakpoints to the manager (will be set after launch for some adapters)
    for (const bp of this.config.breakpoints) {
      this.breakpointManager.addBreakpoint(bp);
    }

    // Add logpoints
    if (this.config.logpoints) {
      for (const lp of this.config.logpoints) {
        this.breakpointManager.addLogpoint(lp);
      }
    }

    // Some adapters (like debugpy) require launch before breakpoints can be set
    const requiresLaunchFirst = this.config.adapter.requiresLaunchFirst === true;

    if (!requiresLaunchFirst) {
      // Standard DAP flow: set breakpoints before launch
      this.state = 'configuring';
      await this.breakpointManager.setAllBreakpoints();
      await this.setExceptionBreakpoints();
    }

    // Launch or attach
    if (this.config.attach && this.config.pid) {
      // Attach to running process
      const attachConfig = this.config.adapter.attachConfig({
        pid: this.config.pid,
      });

      await this.client.attach(attachConfig);

      if (requiresLaunchFirst) {
        // Wait for 'initialized' event after attach, then set breakpoints
        await this.waitForInitialized();
        this.state = 'configuring';
        await this.breakpointManager.setAllBreakpoints();
        await this.setExceptionBreakpoints();
      }

      // Signal configuration done
      await this.client.configurationDone();

      this.state = 'running';
      this.formatter.emit(
        this.formatter.createEvent('process_attached', {
          pid: this.config.pid,
        })
      );
    } else {
      // Launch the program
      const launchConfig = this.config.adapter.launchConfig({
        program: this.config.program!,
        args: this.config.args,
        cwd: this.config.cwd,
        env: this.config.env,
      });

      if (process.env.DEBUG_DAP) {
        console.error('[Launch config]', JSON.stringify(launchConfig, null, 2));
      }

      // Adapter-specific order varies:
      // - js-debug (socket): configurationDone before launch
      // - vsdbg (stdio): launch before configurationDone
      // - debugpy (requiresLaunchFirst): launch, wait for initialized, set breakpoints, configurationDone
      const isSocketAdapter = this.config.adapter.transport === 'socket';

      if (requiresLaunchFirst) {
        // debugpy-style DAP flow:
        // 1. Send launch (starts debuggee server but doesn't run code yet)
        // 2. Wait for 'initialized' event (debuggee server is ready)
        // 3. Set breakpoints (now the server can accept them)
        // 4. Send configurationDone (signals program can start running)
        // 5. Wait for launch response
        const launchPromise = this.client.launch(launchConfig);
        await this.waitForInitialized();
        this.state = 'configuring';
        await this.breakpointManager.setAllBreakpoints();
        await this.setExceptionBreakpoints();
        await this.client.configurationDone();
        await launchPromise;
      } else if (isSocketAdapter) {
        // js-debug requires configurationDone before launch
        await this.client.configurationDone();
        await this.client.launch(launchConfig);
      } else {
        // vsdbg requires launch before configurationDone
        await this.client.launch(launchConfig);
        await this.client.configurationDone();
      }

      this.state = 'running';
      this.formatter.emit(this.formatter.createEvent('process_launched', {}));
    }
  }

  /**
   * Wait for the 'initialized' event from the debug adapter
   */
  private async waitForInitialized(): Promise<void> {
    return new Promise((resolve) => {
      // Check if already received (unlikely but possible)
      const onInitialized = () => {
        resolve();
      };
      this.client!.once('initialized', onInitialized);

      // Timeout after 30 seconds
      const timeout = setTimeout(() => {
        this.client!.removeListener('initialized', onInitialized);
        resolve(); // Continue anyway - some adapters may not send this event
      }, 30000);

      // Clear timeout if initialized is received
      this.client!.once('initialized', () => {
        clearTimeout(timeout);
      });
    });
  }

  /**
   * Set exception breakpoints if configured
   */
  private async setExceptionBreakpoints(): Promise<void> {
    if (this.config.exceptionFilters && this.config.exceptionFilters.length > 0) {
      await this.client!.setExceptionBreakpoints({
        filters: this.config.exceptionFilters,
      });
      this.formatter.emit(
        this.formatter.createEvent('exception_breakpoint_set', {
          filters: this.config.exceptionFilters,
        })
      );
    }
  }

  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.on('stopped', async (body: StoppedEventBody) => {
      await this.handleStopped(body);
    });

    this.client.on('exited', (body: ExitedEventBody) => {
      this.handleExited(body);
    });

    this.client.on('terminated', () => {
      this.handleTerminated();
    });

    this.client.on('output', (body: OutputEventBody) => {
      this.handleOutput(body);
    });

    this.client.on('error', (error: Error) => {
      this.formatter.error('Debug adapter error', error.message);
    });

    this.client.on('exit', () => {
      this.handleAdapterExit();
    });
  }

  private async handleStopped(body: StoppedEventBody): Promise<void> {
    this.state = 'stopped';
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
        file: topFrame?.source?.path ?? 'unknown',
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

      // Run evaluations if specified (skip for breakpoints when evalAfterStep is enabled)
      let evaluations:
        | Record<string, { result: string; type?: string; error?: string }>
        | undefined;
      const shouldDeferEval = this.config.evalAfterStep && reason === 'breakpoint';
      if (this.config.evaluations?.length && topFrame && !shouldDeferEval) {
        evaluations = await this.variableInspector!.evaluateExpressions(
          topFrame.id,
          this.config.evaluations
        );
      }

      // Handle trace step
      if (reason === 'step' && this.isTracing) {
        await this.handleTraceStep(
          threadId,
          location,
          stackResponse.stackFrames.length,
          stackTrace,
          topFrame?.id
        );
        return;
      }

      // Handle eval-after-step completion
      if (reason === 'step' && this.isEvalAfterStep && this.evalAfterStepData) {
        this.isEvalAfterStep = false;
        const pendingData = this.evalAfterStepData;
        this.evalAfterStepData = null;

        // Now evaluate expressions after the line has executed
        let evaluations:
          | Record<string, { result: string; type?: string; error?: string }>
          | undefined;
        if (this.config.evaluations?.length && topFrame) {
          evaluations = await this.variableInspector!.evaluateExpressions(
            topFrame.id,
            this.config.evaluations
          );
        }

        // Check assertions
        if (topFrame) {
          const failed = await this.checkAssertions(topFrame.id);
          if (failed) {
            await this.emitAssertionFailed(
              pendingData.threadId,
              failed.assertion,
              failed.value,
              failed.error,
              location,
              stackTrace,
              topFrame.id
            );
            this.endSession();
            return;
          }
        }

        // Emit breakpoint_hit with original location but current evaluations/locals
        const event: BreakpointHitEvent = {
          type: 'breakpoint_hit',
          timestamp: new Date().toISOString(),
          id: pendingData.breakpointId,
          threadId: pendingData.threadId,
          location: pendingData.originalLocation,
          stackTrace: pendingData.originalStackTrace,
          locals,
          evaluations,
        };
        this.formatter.emit(event);

        // Start trace mode if configured (takes precedence over steps)
        if (this.config.trace) {
          await this.startTrace(
            pendingData.threadId,
            location,
            stackResponse.stackFrames.length,
            topFrame?.id
          );
          return;
        }

        // If steps are configured, start stepping (steps minus 1 since we already stepped)
        if (this.config.steps && this.config.steps > 1) {
          this.remainingSteps = this.config.steps - 1;
          this.isStepping = true;
          await this.client!.next({ threadId });
          this.state = 'running';
          return;
        }

        // Continue execution after capturing state
        await this.client!.continue({ threadId });
        this.state = 'running';
        return;
      }

      // Handle step completion (non-trace stepping)
      if (reason === 'step' && this.isStepping) {
        this.stepsExecuted++;
        this.remainingSteps--;

        // Check assertions after step
        if (topFrame) {
          const failed = await this.checkAssertions(topFrame.id);
          if (failed) {
            await this.emitAssertionFailed(
              threadId,
              failed.assertion,
              failed.value,
              failed.error,
              location,
              stackTrace,
              topFrame.id
            );
            this.isStepping = false;
            this.endSession();
            return;
          }
        }

        // Emit step_completed event if capturing each step
        if (this.config.captureEachStep) {
          const event: StepCompletedEvent = {
            type: 'step_completed',
            timestamp: new Date().toISOString(),
            threadId,
            location,
            stackTrace,
            locals,
          };
          this.formatter.emit(event);
        }

        // If more steps remain, continue stepping
        if (this.remainingSteps > 0) {
          await this.client!.next({ threadId });
          this.state = 'running';
          return;
        }

        // Done stepping, continue execution
        this.isStepping = false;
        await this.client!.continue({ threadId });
        this.state = 'running';
        return;
      }

      // Handle exception
      if (reason === 'exception') {
        this.exceptionsCaught++;

        // If tracing, end the trace first with exception reason
        if (this.isTracing) {
          await this.endTrace(threadId, 'exception', stackTrace, topFrame?.id);
        }

        // Build base exception event
        const event: ExceptionThrownEvent = {
          type: 'exception_thrown',
          timestamp: new Date().toISOString(),
          threadId,
          exception: {
            type: body.text ?? 'Exception',
            message: body.description ?? 'Unknown exception',
          },
          location,
          locals,
        };

        // Flatten exception chain if enabled (default: true)
        if (this.config.flattenExceptions !== false) {
          const chainResult = flattenExceptionChainFromLocals(
            locals,
            this.config.exceptionChainDepth ?? 10
          );

          if (chainResult) {
            event.exceptionChain = chainResult.chain;
            event.rootCause = chainResult.rootCause;
          }
        }

        this.formatter.emit(event);

        // Continue after exception (trace already ended and continued if tracing)
        if (!this.isTracing) {
          await this.client!.continue({ threadId });
          this.state = 'running';
        }
        return;
      }

      // Handle breakpoint hit
      if (reason === 'breakpoint') {
        // If tracing and we hit another breakpoint, end the trace first
        if (this.isTracing) {
          await this.endTrace(threadId, 'breakpoint', stackTrace, topFrame?.id);
        }

        this.breakpointsHit++;

        // If evalAfterStep is enabled, step first before evaluating
        if (this.config.evalAfterStep && this.config.evaluations?.length) {
          this.isEvalAfterStep = true;
          this.evalAfterStepData = {
            threadId,
            originalLocation: location,
            originalStackTrace: stackTrace,
            breakpointId: body.hitBreakpointIds?.[0],
          };
          await this.client!.next({ threadId });
          this.state = 'running';
          return;
        }

        // Check assertions before emitting breakpoint_hit
        if (topFrame) {
          const failed = await this.checkAssertions(topFrame.id);
          if (failed) {
            await this.emitAssertionFailed(
              threadId,
              failed.assertion,
              failed.value,
              failed.error,
              location,
              stackTrace,
              topFrame.id
            );
            // End session on assertion failure
            this.endSession();
            return;
          }
        }

        const event: BreakpointHitEvent = {
          type: 'breakpoint_hit',
          timestamp: new Date().toISOString(),
          id: body.hitBreakpointIds?.[0],
          threadId,
          location,
          stackTrace,
          locals,
          evaluations,
        };
        this.formatter.emit(event);

        // Start trace mode if configured (takes precedence over steps)
        if (this.config.trace) {
          await this.startTrace(threadId, location, stackResponse.stackFrames.length, topFrame?.id);
          return;
        }

        // If steps are configured, start stepping
        if (this.config.steps && this.config.steps > 0) {
          this.remainingSteps = this.config.steps;
          this.isStepping = true;
          await this.client!.next({ threadId });
          this.state = 'running';
          return;
        }

        // Continue execution after capturing state
        await this.client!.continue({ threadId });
        this.state = 'running';
        return;
      }

      // Handle other stop reasons (emit as breakpoint_hit for compatibility)
      const event: BreakpointHitEvent = {
        type: 'breakpoint_hit',
        timestamp: new Date().toISOString(),
        id: body.hitBreakpointIds?.[0],
        threadId,
        location,
        stackTrace,
        locals,
        evaluations,
      };
      this.formatter.emit(event);

      // Continue execution after capturing state
      await this.client!.continue({ threadId });
      this.state = 'running';
    } catch (error) {
      this.formatter.error(
        'Failed to handle stopped event',
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
      this.formatter.createEvent('process_exited', {
        exitCode: body.exitCode,
        durationMs: Date.now() - this.startTime,
      })
    );
  }

  private handleTerminated(): void {
    this.state = 'terminated';
    this.endSession();
  }

  private handleOutput(body: OutputEventBody): void {
    if (body.category === 'stdout' || body.category === 'stderr' || body.category === 'console') {
      this.formatter.programOutput(body.category, body.output);
    }
  }

  private handleAdapterExit(): void {
    if (this.state !== 'terminated') {
      this.state = 'terminated';
      this.endSession();
    }
  }

  private handleTimeout(): void {
    this.formatter.error('Session timed out', `Timeout after ${this.config.timeout}ms`);
    this.endSessionWithError(new Error(`Session timed out after ${this.config.timeout}ms`));
  }

  private endSessionWithError(error: Error): void {
    // Store the error so run() can throw it after promise resolves
    this.sessionError = error;

    // Emit session end (only once)
    if (!this.sessionEndEmitted) {
      this.sessionEndEmitted = true;
      this.formatter.sessionEnd({
        durationMs: Date.now() - this.startTime,
        exitCode: this.exitCode,
        breakpointsHit: this.breakpointsHit,
        exceptionsCaught: this.exceptionsCaught,
        stepsExecuted: this.stepsExecuted,
      });
    }

    // Resolve the session promise (not reject, to avoid unhandled promise rejection
    // if timeout fires during start())
    if (this.sessionResolve) {
      this.sessionResolve();
      this.sessionResolve = null;
    }
  }

  private endSession(): void {
    // Emit session end (only once)
    if (!this.sessionEndEmitted) {
      this.sessionEndEmitted = true;
      this.formatter.sessionEnd({
        durationMs: Date.now() - this.startTime,
        exitCode: this.exitCode,
        breakpointsHit: this.breakpointsHit,
        exceptionsCaught: this.exceptionsCaught,
        stepsExecuted: this.stepsExecuted,
      });
    }

    // Resolve the session promise
    if (this.sessionResolve) {
      this.sessionResolve();
      this.sessionResolve = null;
    }
  }

  private async cleanup(): Promise<void> {
    // Clear timeout
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }

    // Disconnect client
    // In attach mode, don't terminate the debuggee - leave the process running
    if (this.client?.isConnected()) {
      try {
        const terminateDebuggee = !this.config.attach;
        await this.client.disconnect(terminateDebuggee);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  // ========== Trace Mode Methods ==========

  /**
   * Start trace mode after hitting a breakpoint
   */
  private async startTrace(
    threadId: number,
    location: SourceLocation,
    stackDepth: number,
    frameId?: number
  ): Promise<void> {
    this.isTracing = true;
    this.traceStepCount = 0;
    this.tracePath = [location];
    this.traceInitialStackDepth = stackDepth;

    // Initialize diff state with current locals if enabled
    if (this.config.diffVars && frameId) {
      this.previousLocals = await this.variableInspector!.getLocals(frameId);
    } else {
      this.previousLocals = {};
    }

    const event: TraceStartedEvent = {
      type: 'trace_started',
      timestamp: new Date().toISOString(),
      threadId,
      startLocation: location,
      initialStackDepth: stackDepth,
      traceConfig: {
        stepInto: this.config.traceInto ?? false,
        limit: this.config.traceLimit ?? 500,
        untilExpression: this.config.traceUntil,
      },
    };
    this.formatter.emit(event);

    // Begin stepping
    if (this.config.traceInto) {
      await this.client!.stepIn({ threadId });
    } else {
      await this.client!.next({ threadId });
    }
    this.state = 'running';
  }

  /**
   * Handle a step during trace mode
   */
  private async handleTraceStep(
    threadId: number,
    location: SourceLocation,
    stackDepth: number,
    stackFrames: StackFrameInfo[],
    frameId?: number
  ): Promise<void> {
    this.traceStepCount++;
    this.tracePath.push(location);

    // Build trace_step event
    const stepEvent: TraceStepEvent = {
      type: 'trace_step',
      timestamp: new Date().toISOString(),
      threadId,
      stepNumber: this.traceStepCount,
      location,
      stackDepth,
    };

    // Compute variable diff if enabled
    if (this.config.diffVars && frameId) {
      const currentLocals = await this.variableInspector!.getLocals(frameId);
      const changes = this.variableInspector!.diffVariables(this.previousLocals, currentLocals);

      if (changes.length > 0) {
        stepEvent.changes = changes;
      }

      this.previousLocals = currentLocals;
    }

    this.formatter.emit(stepEvent);

    // Check assertions during trace
    if (frameId) {
      const failed = await this.checkAssertions(frameId);
      if (failed) {
        await this.emitAssertionFailed(
          threadId,
          failed.assertion,
          failed.value,
          failed.error,
          location,
          stackFrames,
          frameId
        );
        // End trace and session
        this.isTracing = false;
        this.endSession();
        return;
      }
    }

    // Check stop conditions
    const stopReason = await this.checkTraceStopConditions(stackDepth, frameId);

    if (stopReason) {
      await this.endTrace(threadId, stopReason, stackFrames, frameId);
      return;
    }

    // Continue stepping
    if (this.config.traceInto) {
      await this.client!.stepIn({ threadId });
    } else {
      await this.client!.next({ threadId });
    }
    this.state = 'running';
  }

  /**
   * Check if any trace stop conditions are met
   */
  private async checkTraceStopConditions(
    currentStackDepth: number,
    frameId?: number
  ): Promise<TraceStopReason | null> {
    const limit = this.config.traceLimit ?? 500;

    // Check 1: Limit reached
    if (this.traceStepCount >= limit) {
      return 'limit_reached';
    }

    // Check 2: Function return (stepped out of initial function)
    if (currentStackDepth < this.traceInitialStackDepth) {
      return 'function_return';
    }

    // Check 3: --trace-until expression
    if (this.config.traceUntil && frameId) {
      try {
        const result = await this.client!.evaluate({
          expression: this.config.traceUntil,
          frameId,
          context: 'watch',
        });
        if (this.isTruthy(result.result)) {
          return 'expression_true';
        }
      } catch {
        // Expression evaluation failed - continue tracing
      }
    }

    return null;
  }

  /**
   * End trace mode and emit trace_completed event
   */
  private async endTrace(
    threadId: number,
    reason: TraceStopReason,
    stackFrames: StackFrameInfo[],
    frameId?: number
  ): Promise<void> {
    this.isTracing = false;

    const finalLocation = this.tracePath[this.tracePath.length - 1] ?? {
      file: 'unknown',
      line: 0,
    };

    // Capture full locals at trace completion
    let locals: Record<string, VariableValue> = {};
    if (frameId && this.config.captureLocals !== false) {
      locals = await this.variableInspector!.getLocals(frameId);
    }

    // Run evaluations at trace completion
    let evaluations: Record<string, { result: string; type?: string; error?: string }> | undefined;
    if (this.config.evaluations?.length && frameId) {
      evaluations = await this.variableInspector!.evaluateExpressions(
        frameId,
        this.config.evaluations
      );
    }

    const event: TraceCompletedEvent = {
      type: 'trace_completed',
      timestamp: new Date().toISOString(),
      threadId,
      stopReason: reason,
      stepsExecuted: this.traceStepCount,
      path: this.tracePath,
      finalLocation,
      stackTrace: stackFrames,
      locals,
      evaluations,
    };
    this.formatter.emit(event);

    // Update session statistics
    this.stepsExecuted += this.traceStepCount;

    // Reset trace state
    this.traceStepCount = 0;
    this.tracePath = [];
    this.traceInitialStackDepth = 0;
    this.previousLocals = {};

    // Continue execution after trace
    await this.client!.continue({ threadId });
    this.state = 'running';
  }

  /**
   * Check if a value is truthy
   */
  private isTruthy(value: string): boolean {
    const lower = value.toLowerCase();
    if (lower === 'true') return true;
    if (
      lower === 'false' ||
      lower === 'null' ||
      lower === 'undefined' ||
      lower === 'none' ||
      lower === 'nil'
    ) {
      return false;
    }
    // Non-zero numbers are truthy
    const num = parseFloat(value);
    if (!isNaN(num)) return num !== 0;
    // Non-empty strings are truthy (but not empty string representations)
    return value.length > 0 && value !== '""' && value !== "''";
  }

  // ========== Assertion Methods ==========

  /**
   * Check all assertions against current frame state
   * @returns First failed assertion or null if all pass
   */
  private async checkAssertions(
    frameId: number
  ): Promise<{ assertion: string; value: string; error?: string } | null> {
    if (!this.config.assertions?.length) return null;

    for (const assertion of this.config.assertions) {
      try {
        const result = await this.client!.evaluate({
          expression: assertion,
          frameId,
          context: 'watch',
        });

        // Assertion fails if result is falsy
        if (!this.isTruthy(result.result)) {
          return {
            assertion,
            value: result.result,
          };
        }
      } catch (error) {
        // Evaluation error = assertion failed
        return {
          assertion,
          value: '',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return null; // All assertions passed
  }

  /**
   * Emit assertion failed event and end session
   */
  private async emitAssertionFailed(
    threadId: number,
    assertion: string,
    actualValue: string,
    evaluationError: string | undefined,
    location: SourceLocation,
    stackTrace: StackFrameInfo[],
    frameId: number
  ): Promise<void> {
    // Capture full locals for debugging context
    let locals: Record<string, VariableValue> = {};
    if (this.config.captureLocals !== false) {
      locals = await this.variableInspector!.getLocals(frameId);
    }

    const event: AssertionFailedEvent = {
      type: 'assertion_failed',
      timestamp: new Date().toISOString(),
      threadId,
      assertion,
      actualValue,
      evaluationError,
      location,
      stackTrace,
      locals,
    };

    this.formatter.emit(event);
  }
}
