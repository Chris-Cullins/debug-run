import type { IDapClient } from '../dap/client-interface.js';
import type { StoppedEventBody, StackFrame } from '../dap/protocol.js';
import { VariableInspector } from '../session/variables.js';

export class ControlError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export type SessionOutcome =
  'exited' | 'terminated' | 'stopped' | 'timeout' | 'adapter_error' | 'startup_error';
export interface LiveCommand {
  action: 'status' | 'inspect' | 'step' | 'continue' | 'pause' | 'stop';
  stopId?: number;
  frameId?: number;
  threadId?: number;
  expression?: string;
  depth?: number;
  kind?: 'over' | 'into' | 'out';
}

export interface LiveStatus {
  state: 'starting' | 'running' | 'paused' | 'ended' | 'failed';
  stop?: {
    id: number;
    threadId: number;
    reason: string;
    allThreadsStopped: boolean;
    stack: StackFrame[];
    ready: boolean;
    error?: string;
  };
  outcome?: SessionOutcome;
  exitCode?: number;
  error?: string;
}

/** Owns live stop identities. DAP events can invalidate an in-flight command. */
export class SessionController {
  private client?: IDapClient;
  private end?: () => void;
  private generation = 0;
  private status: LiveStatus = { state: 'starting' };
  private queue: Promise<unknown> = Promise.resolve();

  bind(client: IDapClient, end: () => void): void {
    this.client = client;
    this.end = end;
  }

  started(): void {
    if (this.status.state === 'starting') this.status = { state: 'running' };
  }

  continued(): void {
    if (!this.isFinished()) this.status = { state: 'running' };
  }

  finish(outcome: SessionOutcome, error?: string, exitCode?: number): void {
    if (this.isFinished()) return;
    this.status = {
      state: error ? 'failed' : 'ended',
      outcome,
      ...(error ? { error } : {}),
      ...(exitCode !== undefined ? { exitCode } : {}),
    };
  }

  abort(outcome: SessionOutcome, error?: string): void {
    this.finish(outcome, error);
    this.end?.();
  }

  snapshot(): LiveStatus {
    return structuredClone(this.status);
  }

  private isFinished(): boolean {
    return this.status.state === 'ended' || this.status.state === 'failed';
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => {});
    return next;
  }

  async stopped(body: StoppedEventBody): Promise<void> {
    if (this.isFinished()) return;
    // Invalidate references immediately, even while an inspection is in flight.
    const stop = {
      id: ++this.generation,
      threadId: body.threadId ?? 1,
      reason: body.reason,
      allThreadsStopped: body.allThreadsStopped === true,
      stack: [] as StackFrame[],
      ready: false,
      error: undefined as string | undefined,
    };
    this.status = { state: 'paused', stop };
    await this.serial(async () => {
      if (this.status.stop !== stop) return;
      try {
        const response = await this.client!.stackTrace({ threadId: stop.threadId, levels: 20 });
        if (this.status.stop !== stop) return;
        stop.stack = response.stackFrames;
        stop.ready = true;
      } catch (error) {
        if (this.status.stop === stop) {
          stop.error = error instanceof Error ? error.message : String(error);
          stop.ready = true;
        }
      }
    });
  }

  execute(command: LiveCommand): Promise<unknown> {
    return this.serial(() => this.executeSerial(command));
  }

  private requireStop(expected?: number): NonNullable<LiveStatus['stop']> {
    const stop = this.status.stop;
    if (expected !== undefined && stop?.id !== expected) {
      throw new ControlError(
        'STALE_STOP',
        'The requested stop is no longer current; read status again.'
      );
    }
    if (this.status.state !== 'paused' || !stop) {
      throw new ControlError('NOT_PAUSED', 'The target must be paused for this command.');
    }
    return stop;
  }

  private async executeSerial(command: LiveCommand): Promise<unknown> {
    if (command.action === 'status') {
      return { ...this.snapshot(), capabilities: this.client?.getCapabilities() ?? {} };
    }
    if (command.action === 'stop') {
      if (!this.isFinished()) {
        this.finish('stopped');
        this.end?.();
      }
      return this.snapshot();
    }
    if (!this.client || this.isFinished() || this.status.state === 'starting') {
      throw new ControlError('SESSION_NOT_READY', 'The session is starting or has already ended.');
    }
    if (command.action === 'pause') {
      if (this.status.state === 'paused') return this.snapshot();
      const threads = await this.client.threads();
      const id = command.threadId ?? threads.threads[0]?.id;
      if (id === undefined || !threads.threads.some((thread) => thread.id === id)) {
        throw new ControlError('INVALID_THREAD', 'No matching thread is available to pause.');
      }
      await this.client.pause(id);
      return this.snapshot();
    }
    const stop = this.requireStop(command.stopId);
    if (command.action === 'inspect') {
      if (command.frameId !== undefined && command.stopId === undefined) {
        throw new ControlError(
          'STOP_REQUIRED',
          'Selecting a frame requires --stop from the same status response.'
        );
      }
      const frameId = command.frameId ?? stop.stack[0]?.id;
      if (frameId === undefined || !stop.stack.some((frame) => frame.id === frameId)) {
        throw new ControlError('INVALID_FRAME', 'Select a frame listed in the current stop stack.');
      }
      const depth = command.depth ?? 2;
      const inspector = new VariableInspector(this.client, {
        maxDepth: depth,
        maxCollectionItems: 20,
        maxVariables: 200,
        compactServices: false,
        omitNullProperties: false,
        captureClosures: true,
      });
      let value: unknown;
      if (command.expression !== undefined) {
        const response = await this.client.evaluate({
          expression: command.expression,
          frameId,
          context: 'watch',
        });
        this.requireStop(stop.id);
        value = await inspector.expandVariable(
          {
            name: command.expression,
            value: response.result,
            type: response.type,
            variablesReference: response.variablesReference ?? 0,
          },
          depth
        );
      } else {
        value = await inspector.getLocals(frameId);
      }
      this.requireStop(stop.id);
      return {
        stopId: stop.id,
        frameId,
        value,
        truncated: inspector.truncated,
        limits: { depth, maxCollectionItems: 20, maxVariables: 200 },
      };
    }
    // Invalidate before sending; a stopped/continued event may precede the response.
    this.continued();
    try {
      if (command.action === 'continue') {
        await this.client.continue({ threadId: stop.threadId });
      } else if (command.action === 'step') {
        const args = { threadId: stop.threadId };
        if (command.kind === 'into') await this.client.stepIn(args);
        else if (command.kind === 'out') await this.client.stepOut(args);
        else await this.client.next(args);
      }
    } catch (error) {
      this.abort('adapter_error', error instanceof Error ? error.message : String(error));
      throw error;
    }
    return this.snapshot();
  }
}
