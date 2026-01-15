/**
 * Output Event Types
 *
 * These are the events emitted by debug-run as NDJSON output.
 */

// Location information
export interface SourceLocation {
  file: string;
  line: number;
  column?: number;
  function?: string;
  module?: string;
}

// Variable representation
export interface VariableValue {
  type: string;
  value: unknown;
  expandable?: boolean;
  variablesReference?: number;
  /** True if this variable references an already-visited object (circular reference) */
  circular?: boolean;
}

// Stack frame in output
export interface StackFrameInfo {
  frameId: number;
  function: string;
  file: string | null;
  line: number | null;
  column?: number | null;
  module?: string;
}

// Base event type
interface BaseEvent {
  type: string;
  timestamp: string;
}

// Session lifecycle events
export interface SessionStartEvent extends BaseEvent {
  type: "session_start";
  adapter: string;
  program: string;
  args?: string[];
  cwd?: string;
}

export interface SessionEndEvent extends BaseEvent {
  type: "session_end";
  summary: {
    durationMs: number;
    exitCode: number | null;
    breakpointsHit: number;
    exceptionsCaught: number;
    stepsExecuted: number;
  };
}

// Process events
export interface ProcessLaunchedEvent extends BaseEvent {
  type: "process_launched";
  pid?: number;
}

export interface ProcessExitedEvent extends BaseEvent {
  type: "process_exited";
  exitCode: number;
  durationMs: number;
}

// Breakpoint events
export interface BreakpointSetEvent extends BaseEvent {
  type: "breakpoint_set";
  id: number;
  file: string;
  line: number;
  verified: boolean;
  condition?: string;
  message?: string;
}

export interface BreakpointHitEvent extends BaseEvent {
  type: "breakpoint_hit";
  id?: number;
  threadId: number;
  location: SourceLocation;
  stackTrace: StackFrameInfo[];
  locals: Record<string, VariableValue>;
  evaluations?: Record<string, { result: string; type?: string; error?: string }>;
}

// Exception events
export interface ExceptionThrownEvent extends BaseEvent {
  type: "exception_thrown";
  threadId: number;
  exception: {
    type: string;
    message: string;
    stackTrace?: string;
    innerException?: string;
  };
  location: SourceLocation;
  locals: Record<string, VariableValue>;
}

// Stepping events
export interface StepCompletedEvent extends BaseEvent {
  type: "step_completed";
  threadId: number;
  location: SourceLocation;
  stackTrace: StackFrameInfo[];
  locals: Record<string, VariableValue>;
}

// Output from the debuggee
export interface ProgramOutputEvent extends BaseEvent {
  type: "program_output";
  category: "stdout" | "stderr" | "console";
  output: string;
}

// Error events
export interface ErrorEvent extends BaseEvent {
  type: "error";
  message: string;
  details?: string;
}

// Union type of all events
export type DebugEvent =
  | SessionStartEvent
  | SessionEndEvent
  | ProcessLaunchedEvent
  | ProcessExitedEvent
  | BreakpointSetEvent
  | BreakpointHitEvent
  | ExceptionThrownEvent
  | StepCompletedEvent
  | ProgramOutputEvent
  | ErrorEvent;
