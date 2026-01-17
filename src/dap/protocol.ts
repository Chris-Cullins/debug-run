/**
 * DAP Protocol Types
 *
 * These types define the Debug Adapter Protocol messages.
 * Based on @vscode/debugprotocol but simplified for our needs.
 */

// Base message types
export interface ProtocolMessage {
  seq: number;
  type: 'request' | 'response' | 'event';
}

export interface Request extends ProtocolMessage {
  type: 'request';
  command: string;
  arguments?: unknown;
}

export interface Response extends ProtocolMessage {
  type: 'response';
  request_seq: number;
  success: boolean;
  command: string;
  message?: string;
  body?: unknown;
}

export interface Event extends ProtocolMessage {
  type: 'event';
  event: string;
  body?: unknown;
}

// Capabilities returned by initialize
export interface Capabilities {
  supportsConfigurationDoneRequest?: boolean;
  supportsFunctionBreakpoints?: boolean;
  supportsConditionalBreakpoints?: boolean;
  supportsHitConditionalBreakpoints?: boolean;
  supportsEvaluateForHovers?: boolean;
  supportsExceptionOptions?: boolean;
  supportsExceptionInfoRequest?: boolean;
  supportsValueFormattingOptions?: boolean;
  supportsStepBack?: boolean;
  supportsSetVariable?: boolean;
  supportsRestartFrame?: boolean;
  supportsGotoTargetsRequest?: boolean;
  supportsStepInTargetsRequest?: boolean;
  supportsCompletionsRequest?: boolean;
  supportsModulesRequest?: boolean;
  supportsLogPoints?: boolean;
}

// Breakpoint types
export interface SourceBreakpoint {
  line: number;
  column?: number;
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
}

export interface Breakpoint {
  id?: number;
  verified: boolean;
  message?: string;
  source?: Source;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

export interface Source {
  name?: string;
  path?: string;
  sourceReference?: number;
}

// Stack and variables
export interface StackFrame {
  id: number;
  name: string;
  source?: Source;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  moduleId?: number | string;
  presentationHint?: 'normal' | 'label' | 'subtle';
}

export interface Scope {
  name: string;
  variablesReference: number;
  namedVariables?: number;
  indexedVariables?: number;
  expensive: boolean;
  source?: Source;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

export interface Variable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
  namedVariables?: number;
  indexedVariables?: number;
  evaluateName?: string;
}

// Thread
export interface Thread {
  id: number;
  name: string;
}

// Exception
export interface ExceptionBreakpointsFilter {
  filter: string;
  label: string;
  description?: string;
  default?: boolean;
  supportsCondition?: boolean;
  conditionDescription?: string;
}

// Request arguments
export interface InitializeRequestArguments {
  clientID?: string;
  clientName?: string;
  adapterID: string;
  locale?: string;
  linesStartAt1?: boolean;
  columnsStartAt1?: boolean;
  pathFormat?: 'path' | 'uri';
  supportsVariableType?: boolean;
  supportsVariablePaging?: boolean;
  supportsRunInTerminalRequest?: boolean;
  supportsMemoryReferences?: boolean;
  supportsProgressReporting?: boolean;
  supportsInvalidatedEvent?: boolean;
}

export interface LaunchRequestArguments {
  noDebug?: boolean;
  [key: string]: unknown;
}

export interface AttachRequestArguments {
  [key: string]: unknown;
}

export interface SetBreakpointsArguments {
  source: Source;
  breakpoints?: SourceBreakpoint[];
  sourceModified?: boolean;
}

export interface SetExceptionBreakpointsArguments {
  filters: string[];
  filterOptions?: ExceptionFilterOptions[];
}

export interface ExceptionFilterOptions {
  filterId: string;
  condition?: string;
}

export interface StackTraceArguments {
  threadId: number;
  startFrame?: number;
  levels?: number;
}

export interface ScopesArguments {
  frameId: number;
}

export interface VariablesArguments {
  variablesReference: number;
  filter?: 'indexed' | 'named';
  start?: number;
  count?: number;
}

export interface EvaluateArguments {
  expression: string;
  frameId?: number;
  context?: 'watch' | 'repl' | 'hover' | 'clipboard';
}

export interface ContinueArguments {
  threadId: number;
  singleThread?: boolean;
}

export interface NextArguments {
  threadId: number;
  singleThread?: boolean;
  granularity?: 'statement' | 'line' | 'instruction';
}

export interface StepInArguments {
  threadId: number;
  singleThread?: boolean;
  targetId?: number;
  granularity?: 'statement' | 'line' | 'instruction';
}

export interface StepOutArguments {
  threadId: number;
  singleThread?: boolean;
  granularity?: 'statement' | 'line' | 'instruction';
}

// Response bodies
export interface InitializeResponse {
  capabilities: Capabilities;
}

export interface SetBreakpointsResponse {
  breakpoints: Breakpoint[];
}

export interface StackTraceResponse {
  stackFrames: StackFrame[];
  totalFrames?: number;
}

export interface ScopesResponse {
  scopes: Scope[];
}

export interface VariablesResponse {
  variables: Variable[];
}

export interface EvaluateResponse {
  result: string;
  type?: string;
  variablesReference: number;
  namedVariables?: number;
  indexedVariables?: number;
}

export interface ThreadsResponse {
  threads: Thread[];
}

export interface ContinueResponse {
  allThreadsContinued?: boolean;
}

// Event bodies
export interface StoppedEventBody {
  reason:
    | 'step'
    | 'breakpoint'
    | 'exception'
    | 'pause'
    | 'entry'
    | 'goto'
    | 'function breakpoint'
    | 'data breakpoint'
    | 'instruction breakpoint'
    | string;
  description?: string;
  threadId?: number;
  preserveFocusHint?: boolean;
  text?: string;
  allThreadsStopped?: boolean;
  hitBreakpointIds?: number[];
}

export interface TerminatedEventBody {
  restart?: unknown;
}

export interface ExitedEventBody {
  exitCode: number;
}

export interface OutputEventBody {
  category?: 'console' | 'important' | 'stdout' | 'stderr' | 'telemetry';
  output: string;
  group?: 'start' | 'startCollapsed' | 'end';
  variablesReference?: number;
  source?: Source;
  line?: number;
  column?: number;
  data?: unknown;
}

export interface BreakpointEventBody {
  reason: 'changed' | 'new' | 'removed';
  breakpoint: Breakpoint;
}
