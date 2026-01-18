/**
 * Output Formatter
 *
 * Serializes debug events to NDJSON for agent consumption.
 */

import type {
  DebugEvent,
  BreakpointDiagnostics,
  StackFrameInfo,
  VariableValue,
  SourceLocation,
} from './events.js';

export interface FormatterOptions {
  /** Write to a custom stream (default: stdout) */
  stream?: NodeJS.WritableStream;
  /** Pretty print JSON (default: false) */
  pretty?: boolean;
  /** Only emit these event types (if specified) */
  include?: string[];
  /** Suppress these event types */
  exclude?: string[];
  /** Enable compact output mode for reduced token usage */
  compact?: boolean;
  /** Maximum stack frames to include (default: 3 in compact mode) */
  stackLimit?: number;
}

/** Patterns for detecting internal/runtime stack frames to filter in compact mode */
const INTERNAL_PATTERNS = [
  /^node:/,
  /node_modules/,
  /internal\//,
  /<anonymous>/,
  /^native /,
  /\[native code\]/,
  /webpack:/,
  /^async /,
  /^Module\./,
  /processTicksAndRejections/,
  /^RunMain$/,
  /^bootstrap_node\.js$/,
  /^_compile$/,
  /^\.js$/,
];

export class OutputFormatter {
  private stream: NodeJS.WritableStream;
  private pretty: boolean;
  private include?: Set<string>;
  private exclude?: Set<string>;
  private compact: boolean;
  private stackLimit: number;

  /** Track previous locals for variable diffing in compact mode */
  private previousLocals: Record<string, unknown> = {};

  constructor(options: FormatterOptions = {}) {
    this.stream = options.stream ?? process.stdout;
    this.pretty = options.pretty ?? false;
    this.include = options.include ? new Set(options.include) : undefined;
    this.exclude = options.exclude ? new Set(options.exclude) : undefined;
    this.compact = options.compact ?? false;
    // Default stack limit: 3 in compact mode, unlimited otherwise
    this.stackLimit = options.stackLimit ?? (options.compact ? 3 : Infinity);
  }

  /**
   * Check if an event type should be emitted based on include/exclude filters
   */
  private shouldEmit(type: string): boolean {
    // If include list is specified, only emit if type is in the list
    if (this.include && !this.include.has(type)) {
      return false;
    }
    // If exclude list is specified, don't emit if type is in the list
    if (this.exclude && this.exclude.has(type)) {
      return false;
    }
    return true;
  }

  /**
   * Emit a debug event
   */
  emit(event: DebugEvent): void {
    if (!this.shouldEmit(event.type)) {
      return;
    }

    // Apply compact transformations if enabled
    const outputEvent = this.compact ? this.compactifyEvent(event) : event;

    const json = this.pretty ? JSON.stringify(outputEvent, null, 2) : JSON.stringify(outputEvent);

    this.stream.write(json + '\n');
  }

  /**
   * Check if a stack frame is an internal/runtime frame
   */
  private isInternalFrame(frame: StackFrameInfo): boolean {
    const file = frame.file ?? '';
    const fn = frame.function ?? '';

    return INTERNAL_PATTERNS.some((pattern) => pattern.test(file) || pattern.test(fn));
  }

  /**
   * Filter and limit stack frames for compact output
   */
  private compactifyStackTrace(frames: StackFrameInfo[]): StackFrameInfo[] {
    // First, filter out internal frames
    const userFrames = frames.filter((frame) => !this.isInternalFrame(frame));

    // If filtering removed all frames, keep the original first frame
    const relevantFrames = userFrames.length > 0 ? userFrames : frames.slice(0, 1);

    // Apply stack limit
    const limitedFrames = relevantFrames.slice(0, this.stackLimit);

    // Abbreviate file paths
    return limitedFrames.map((frame) => ({
      ...frame,
      file: frame.file ? this.abbreviatePath(frame.file) : null,
    }));
  }

  /**
   * Abbreviate a file path for compact output
   */
  private abbreviatePath(filePath: string): string {
    // Replace common prefixes with abbreviations
    let abbreviated = filePath;

    // Handle node_modules paths (do this first, before truncating)
    const nodeModulesMatch = abbreviated.match(/node_modules\/(.+)/);
    if (nodeModulesMatch) {
      // Truncate the module path if it's long
      const modulePath = nodeModulesMatch[1];
      const moduleSegments = modulePath.split('/');
      if (moduleSegments.length > 3) {
        abbreviated = `<node_modules>/${moduleSegments.slice(0, 2).join('/')}/...`;
      } else {
        abbreviated = `<node_modules>/${modulePath}`;
      }
      return abbreviated;
    }

    // Handle home directory
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    if (homeDir && abbreviated.startsWith(homeDir)) {
      abbreviated = '~' + abbreviated.slice(homeDir.length);
    }

    // Truncate very long paths (keep last 3 segments)
    const segments = abbreviated.split('/');
    if (segments.length > 4) {
      abbreviated = '.../' + segments.slice(-3).join('/');
    }

    return abbreviated;
  }

  /**
   * Abbreviate a source location for compact output
   */
  private compactifyLocation(location: SourceLocation): SourceLocation {
    return {
      ...location,
      file: this.abbreviatePath(location.file),
      // Remove module in compact mode as it's often redundant
      module: undefined,
    };
  }

  /**
   * Compact locals by computing diff from previous state
   * Returns only changed variables
   */
  private compactifyLocals(
    locals: Record<string, VariableValue>
  ): Record<string, VariableValue> | { _diff: Record<string, VariableValue> } {
    // Check if this is the first capture (no previous state)
    const isFirstCapture = Object.keys(this.previousLocals).length === 0;

    if (isFirstCapture) {
      // First time - update previous state and return full locals (abbreviated)
      this.previousLocals = { ...locals };
      return this.abbreviateLocals(locals);
    }

    // Compute diff from previous state
    const diff: Record<string, VariableValue> = {};
    let hasChanges = false;

    for (const [name, value] of Object.entries(locals)) {
      const previousValue = this.previousLocals[name];
      const currentJson = JSON.stringify(value);
      const previousJson = previousValue !== undefined ? JSON.stringify(previousValue) : undefined;

      if (currentJson !== previousJson) {
        diff[name] = value;
        hasChanges = true;
      }
    }

    // Check for deleted variables
    for (const name of Object.keys(this.previousLocals)) {
      if (!(name in locals)) {
        hasChanges = true;
        // Mark as deleted with a special value
        diff[name] = { type: 'deleted', value: null };
      }
    }

    // Update previous state
    this.previousLocals = { ...locals };

    // Return diff if there are changes
    if (hasChanges) {
      return { _diff: this.abbreviateLocals(diff) };
    }

    // No changes - return empty object
    return {};
  }

  /**
   * Abbreviate local variable values for compact output
   */
  private abbreviateLocals(locals: Record<string, VariableValue>): Record<string, VariableValue> {
    const abbreviated: Record<string, VariableValue> = {};

    for (const [name, value] of Object.entries(locals)) {
      abbreviated[name] = this.abbreviateValue(value);
    }

    return abbreviated;
  }

  /**
   * Abbreviate a single variable value for compact output
   */
  private abbreviateValue(value: VariableValue): VariableValue {
    // For strings, truncate if very long
    if (typeof value.value === 'string' && value.value.length > 100) {
      return {
        ...value,
        value: value.value.slice(0, 100) + '...',
      };
    }

    // For arrays, show length and abbreviated content
    if (Array.isArray(value.value) && value.value.length > 5) {
      const abbreviated = value.value.slice(0, 3);
      return {
        ...value,
        value: `[${abbreviated.join(', ')}, ... (${value.value.length} items)]`,
      };
    }

    return value;
  }

  /**
   * Apply compact transformations to an event
   */
  private compactifyEvent(event: DebugEvent): DebugEvent {
    switch (event.type) {
      case 'breakpoint_hit': {
        const compacted = {
          ...event,
          location: this.compactifyLocation(event.location),
          stackTrace: this.compactifyStackTrace(event.stackTrace),
        };

        // Apply locals diff
        if (event.locals && Object.keys(event.locals).length > 0) {
          const compactedLocals = this.compactifyLocals(event.locals);
          (compacted as typeof event).locals = compactedLocals as Record<string, VariableValue>;
        }

        return compacted;
      }

      case 'exception_thrown': {
        const compacted = {
          ...event,
          location: this.compactifyLocation(event.location),
        };

        // Abbreviate exception stack trace if present
        if (event.exception.stackTrace) {
          compacted.exception = {
            ...event.exception,
            stackTrace: this.abbreviateStackTraceString(event.exception.stackTrace),
          };
        }

        // Apply locals diff
        if (event.locals && Object.keys(event.locals).length > 0) {
          const compactedLocals = this.compactifyLocals(event.locals);
          (compacted as typeof event).locals = compactedLocals as Record<string, VariableValue>;
        }

        return compacted;
      }

      case 'step_completed': {
        return {
          ...event,
          location: this.compactifyLocation(event.location),
          stackTrace: this.compactifyStackTrace(event.stackTrace),
          locals: this.abbreviateLocals(event.locals),
        };
      }

      case 'trace_step': {
        return {
          ...event,
          location: this.compactifyLocation(event.location),
        };
      }

      case 'trace_completed': {
        // Abbreviate the path in trace_completed
        const compactedPath = event.path.map((loc) => this.compactifyLocation(loc));

        // Collapse consecutive identical locations
        const collapsedPath: SourceLocation[] = [];
        let repeatCount = 1;
        for (let i = 0; i < compactedPath.length; i++) {
          const current = compactedPath[i];
          const next = compactedPath[i + 1];
          if (
            next &&
            current.file === next.file &&
            current.line === next.line &&
            current.function === next.function
          ) {
            repeatCount++;
          } else {
            if (repeatCount > 1) {
              collapsedPath.push({
                ...current,
                function: `${current.function} (x${repeatCount})`,
              });
            } else {
              collapsedPath.push(current);
            }
            repeatCount = 1;
          }
        }

        return {
          ...event,
          path: collapsedPath,
          finalLocation: this.compactifyLocation(event.finalLocation),
          stackTrace: this.compactifyStackTrace(event.stackTrace),
          locals: this.abbreviateLocals(event.locals),
        };
      }

      case 'assertion_failed': {
        return {
          ...event,
          location: this.compactifyLocation(event.location),
          stackTrace: this.compactifyStackTrace(event.stackTrace),
          locals: this.abbreviateLocals(event.locals),
        };
      }

      case 'session_start': {
        // Abbreviate program path and cwd
        const compacted = { ...event };
        if (compacted.program) {
          compacted.program = this.abbreviatePath(compacted.program);
        }
        if (compacted.cwd) {
          compacted.cwd = this.abbreviatePath(compacted.cwd);
        }
        return compacted;
      }

      default:
        return event;
    }
  }

  /**
   * Abbreviate a stack trace string (from exception)
   */
  private abbreviateStackTraceString(stackTrace: string): string {
    const lines = stackTrace.split('\n');

    // Filter out internal frames
    const userLines = lines.filter((line) => {
      return !INTERNAL_PATTERNS.some((pattern) => pattern.test(line));
    });

    // Limit to stackLimit frames
    const limitedLines = userLines.slice(0, this.stackLimit);

    // Abbreviate paths in remaining lines
    return limitedLines.map((line) => this.abbreviatePathsInLine(line)).join('\n');
  }

  /**
   * Abbreviate file paths within a line of text
   */
  private abbreviatePathsInLine(line: string): string {
    // Match common path patterns in stack traces
    return line.replace(/(?:at\s+)?(\/[^\s:]+)/g, (match, path) => {
      const abbreviated = this.abbreviatePath(path);
      return match.replace(path, abbreviated);
    });
  }

  /**
   * Create an event with timestamp
   */
  createEvent<T extends DebugEvent['type']>(
    type: T,
    data: Omit<Extract<DebugEvent, { type: T }>, 'type' | 'timestamp'>
  ): Extract<DebugEvent, { type: T }> {
    return {
      type,
      timestamp: new Date().toISOString(),
      ...data,
    } as Extract<DebugEvent, { type: T }>;
  }

  /**
   * Emit a session_start event (launch mode)
   */
  sessionStart(adapter: string, program: string, args?: string[], cwd?: string): void {
    this.emit(
      this.createEvent('session_start', {
        adapter,
        program,
        args,
        cwd,
      })
    );
  }

  /**
   * Emit a session_start event (attach mode)
   */
  sessionStartAttach(adapter: string, pid: number): void {
    this.emit(
      this.createEvent('session_start', {
        adapter,
        pid,
        attach: true,
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
    this.emit(this.createEvent('session_end', { summary }));
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
    message?: string,
    diagnostics?: BreakpointDiagnostics
  ): void {
    this.emit(
      this.createEvent('breakpoint_set', {
        id,
        file,
        line,
        verified,
        condition,
        message,
        diagnostics,
      })
    );
  }

  /**
   * Emit an error event
   */
  error(message: string, details?: string): void {
    this.emit(this.createEvent('error', { message, details }));
  }

  /**
   * Emit a program_output event
   */
  programOutput(category: 'stdout' | 'stderr' | 'console', output: string): void {
    this.emit(this.createEvent('program_output', { category, output }));
  }
}
