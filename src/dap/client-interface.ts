/**
 * DAP Client Interface
 *
 * Common interface implemented by both stdio and socket-based clients.
 */

import type { EventEmitter } from 'node:events';
import type {
  InitializeRequestArguments,
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
} from './protocol.js';

export interface IDapClient extends EventEmitter {
  connect(): Promise<void>;
  initialize(args?: Partial<InitializeRequestArguments>): Promise<Capabilities>;
  launch(args: LaunchRequestArguments): Promise<void>;
  attach(args: AttachRequestArguments): Promise<void>;
  configurationDone(): Promise<void>;
  setBreakpoints(args: SetBreakpointsArguments): Promise<SetBreakpointsResponse>;
  setExceptionBreakpoints(args: SetExceptionBreakpointsArguments): Promise<void>;
  threads(): Promise<ThreadsResponse>;
  stackTrace(args: StackTraceArguments): Promise<StackTraceResponse>;
  scopes(args: ScopesArguments): Promise<ScopesResponse>;
  variables(args: VariablesArguments): Promise<VariablesResponse>;
  evaluate(args: EvaluateArguments): Promise<EvaluateResponse>;
  continue(args: ContinueArguments): Promise<ContinueResponse>;
  next(args: NextArguments): Promise<void>;
  stepIn(args: StepInArguments): Promise<void>;
  stepOut(args: StepOutArguments): Promise<void>;
  pause(threadId: number): Promise<void>;
  disconnect(terminateDebuggee?: boolean, restart?: boolean): Promise<void>;
  terminate(): Promise<void>;
  getCapabilities(): Capabilities;
  isConnected(): boolean;
}
