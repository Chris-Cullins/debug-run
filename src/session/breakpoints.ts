/**
 * Breakpoint Management
 *
 * Handles parsing, setting, and tracking breakpoints.
 */

import * as path from 'node:path';
import type { IDapClient } from '../dap/client-interface.js';
import type { SourceBreakpoint } from '../dap/protocol.js';
import type { OutputFormatter } from '../output/formatter.js';

export interface BreakpointSpec {
  file: string;
  line: number;
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
}

export interface TrackedBreakpoint extends BreakpointSpec {
  id?: number;
  verified: boolean;
  message?: string;
}

export interface PathResolutionOptions {
  /** Working directory - preferred base for relative paths */
  cwd?: string;
  /** @deprecated Not used - kept for backwards compatibility. Paths resolve against cwd or process.cwd() */
  programPath?: string;
}

/**
 * Resolve a breakpoint file path.
 *
 * Resolution order:
 * 1. If file is absolute, use as-is
 * 2. If cwd is provided, resolve relative to cwd (most intuitive for users)
 * 3. Default: resolve against process.cwd()
 *
 * This allows users to specify breakpoints like "src/file.ts:3" relative to
 * their project root (cwd) or the directory where debug-run was invoked.
 */
function resolveBreakpointPath(file: string, options: PathResolutionOptions = {}): string {
  // If absolute, use as-is
  if (path.isAbsolute(file)) {
    return file;
  }

  // Prefer cwd if provided (most intuitive for repo-relative paths)
  if (options.cwd) {
    return path.resolve(options.cwd, file);
  }

  // Default: resolve against process cwd (where user invoked debug-run)
  // This is the most intuitive behavior for repo-relative paths like "src/file.ts:10"
  return path.resolve(file);
}

/**
 * Parse a breakpoint specification string
 *
 * Formats supported:
 * - "file.ts:45" - basic file:line
 * - "src/file.ts:45" - with path
 * - "file.ts:45?condition" - with condition
 * - "file.ts:45#3" - with hit count
 *
 * @param spec The breakpoint specification string
 * @param pathOptions Options for resolving relative breakpoint paths
 */
/**
 * Result of validating a breakpoint specification
 */
export interface BreakpointValidationResult {
  valid: boolean;
  error?: string;
  spec?: string;
}

/**
 * Validate a breakpoint specification without fully parsing it.
 * Use this for early validation before starting a debug session.
 *
 * @param spec The breakpoint specification string
 * @returns Validation result with error message if invalid
 */
export function validateBreakpointSpec(spec: string): BreakpointValidationResult {
  const trimmed = spec.trim();

  // Check for empty spec
  if (!trimmed) {
    return {
      valid: false,
      error: 'Breakpoint specification cannot be empty',
      spec,
    };
  }

  // Check for colon separator (must have at least one)
  if (!trimmed.includes(':')) {
    return {
      valid: false,
      error: `Invalid breakpoint format "${spec}". Expected "file:line" (e.g., "Program.cs:42")`,
      spec,
    };
  }

  // Match: file:line?condition or file:line#hitCount
  const match = trimmed.match(/^(.+):(\d+)(?:\?(.+)|#(\d+))?$/);

  if (!match) {
    // Try to give a more specific error message
    const colonIdx = trimmed.lastIndexOf(':');
    if (colonIdx !== -1) {
      const linePartRaw = trimmed.slice(colonIdx + 1);
      // Strip any condition/hitCount suffix for error message
      const linePart = linePartRaw.split('?')[0].split('#')[0];

      if (linePart === '') {
        return {
          valid: false,
          error: `Missing line number in breakpoint "${spec}". Expected "file:line" (e.g., "Program.cs:42")`,
          spec,
        };
      }

      if (!/^\d+$/.test(linePart)) {
        return {
          valid: false,
          error: `Invalid line number "${linePart}" in breakpoint "${spec}". Line must be a positive integer`,
          spec,
        };
      }
    }

    return {
      valid: false,
      error: `Invalid breakpoint format "${spec}". Expected "file:line" (e.g., "Program.cs:42")`,
      spec,
    };
  }

  const [, file, lineStr] = match;
  const line = parseInt(lineStr, 10);

  // Check for empty file path
  if (!file || !file.trim()) {
    return {
      valid: false,
      error: `Missing file path in breakpoint "${spec}". Expected "file:line" (e.g., "Program.cs:42")`,
      spec,
    };
  }

  // Check for valid line number (must be positive)
  if (isNaN(line) || line < 1) {
    return {
      valid: false,
      error: `Invalid line number "${lineStr}" in breakpoint "${spec}". Line must be a positive integer`,
      spec,
    };
  }

  return { valid: true };
}

/**
 * Validate a logpoint specification without fully parsing it.
 * Use this for early validation before starting a debug session.
 *
 * @param spec The logpoint specification string
 * @returns Validation result with error message if invalid
 */
export function validateLogpointSpec(spec: string): BreakpointValidationResult {
  const trimmed = spec.trim();

  // Check for empty spec
  if (!trimmed) {
    return {
      valid: false,
      error: 'Logpoint specification cannot be empty',
      spec,
    };
  }

  // Logpoints must have the pipe separator
  if (!trimmed.includes('|')) {
    return {
      valid: false,
      error: `Invalid logpoint format "${spec}". Expected "file:line|message" (e.g., "Program.cs:42|value is {x}")`,
      spec,
    };
  }

  // Check for colon separator before pipe
  const pipeIdx = trimmed.indexOf('|');
  const beforePipe = trimmed.slice(0, pipeIdx);

  if (!beforePipe.includes(':')) {
    return {
      valid: false,
      error: `Invalid logpoint format "${spec}". Expected "file:line|message" (e.g., "Program.cs:42|value is {x}")`,
      spec,
    };
  }

  // Match: file:line|logMessage
  const match = trimmed.match(/^(.+):(\d+)\|(.+)$/);

  if (!match) {
    // Try to give a more specific error message
    const colonIdx = beforePipe.lastIndexOf(':');
    if (colonIdx !== -1) {
      const linePart = beforePipe.slice(colonIdx + 1);

      if (linePart === '') {
        return {
          valid: false,
          error: `Missing line number in logpoint "${spec}". Expected "file:line|message"`,
          spec,
        };
      }

      if (!/^\d+$/.test(linePart)) {
        return {
          valid: false,
          error: `Invalid line number "${linePart}" in logpoint "${spec}". Line must be a positive integer`,
          spec,
        };
      }
    }

    return {
      valid: false,
      error: `Invalid logpoint format "${spec}". Expected "file:line|message" (e.g., "Program.cs:42|value is {x}")`,
      spec,
    };
  }

  const [, file, lineStr, message] = match;
  const line = parseInt(lineStr, 10);

  // Check for empty file path
  if (!file || !file.trim()) {
    return {
      valid: false,
      error: `Missing file path in logpoint "${spec}". Expected "file:line|message"`,
      spec,
    };
  }

  // Check for valid line number (must be positive)
  if (isNaN(line) || line < 1) {
    return {
      valid: false,
      error: `Invalid line number "${lineStr}" in logpoint "${spec}". Line must be a positive integer`,
      spec,
    };
  }

  // Check for empty message
  if (!message || !message.trim()) {
    return {
      valid: false,
      error: `Missing log message in logpoint "${spec}". Expected "file:line|message"`,
      spec,
    };
  }

  return { valid: true };
}

/**
 * Validate multiple breakpoint and logpoint specifications.
 * Returns all validation errors found.
 *
 * @param breakpoints Array of breakpoint specifications
 * @param logpoints Array of logpoint specifications
 * @returns Array of error messages, empty if all valid
 */
export function validateAllBreakpoints(breakpoints: string[], logpoints: string[] = []): string[] {
  const errors: string[] = [];

  for (const bp of breakpoints) {
    const result = validateBreakpointSpec(bp);
    if (!result.valid && result.error) {
      errors.push(result.error);
    }
  }

  for (const lp of logpoints) {
    const result = validateLogpointSpec(lp);
    if (!result.valid && result.error) {
      errors.push(result.error);
    }
  }

  return errors;
}

export function parseBreakpointSpec(
  spec: string,
  pathOptions: PathResolutionOptions = {}
): BreakpointSpec {
  // Match: file:line?condition or file:line#hitCount
  const match = spec.match(/^(.+):(\d+)(?:\?(.+)|#(\d+))?$/);

  if (!match) {
    throw new Error(
      `Invalid breakpoint format: "${spec}". Expected "file:line" or "file:line?condition"`
    );
  }

  const [, file, lineStr, condition, hitCount] = match;
  const line = parseInt(lineStr, 10);

  if (isNaN(line) || line < 1) {
    throw new Error(`Invalid line number: ${lineStr}`);
  }

  return {
    file: resolveBreakpointPath(file, pathOptions),
    line,
    condition: condition || undefined,
    hitCondition: hitCount || undefined,
  };
}

/**
 * Parse a logpoint specification string
 *
 * Format: "file.ts:45|log message with {expr}"
 * The log message can contain expressions in {braces} that will be evaluated.
 *
 * @param spec The logpoint specification string
 * @param pathOptions Options for resolving relative breakpoint paths
 */
export function parseLogpointSpec(
  spec: string,
  pathOptions: PathResolutionOptions = {}
): BreakpointSpec {
  // Match: file:line|logMessage
  const match = spec.match(/^(.+):(\d+)\|(.+)$/);

  if (!match) {
    throw new Error(`Invalid logpoint format: "${spec}". Expected "file:line|log message"`);
  }

  const [, file, lineStr, logMessage] = match;
  const line = parseInt(lineStr, 10);

  if (isNaN(line) || line < 1) {
    throw new Error(`Invalid line number: ${lineStr}`);
  }

  return {
    file: resolveBreakpointPath(file, pathOptions),
    line,
    logMessage: logMessage.trim(),
  };
}

export class BreakpointManager {
  private client: IDapClient;
  private formatter: OutputFormatter;
  private breakpoints: Map<string, TrackedBreakpoint[]> = new Map();
  private nextId: number = 1;
  private pathOptions: PathResolutionOptions;

  constructor(
    client: IDapClient,
    formatter: OutputFormatter,
    pathOptions: PathResolutionOptions = {}
  ) {
    this.client = client;
    this.formatter = formatter;
    this.pathOptions = pathOptions;
  }

  /**
   * Add a breakpoint from a spec string
   */
  addBreakpoint(spec: string): BreakpointSpec {
    const bp = parseBreakpointSpec(spec, this.pathOptions);
    this.addBreakpointSpec(bp);
    return bp;
  }

  /**
   * Add a logpoint from a spec string
   */
  addLogpoint(spec: string): BreakpointSpec {
    const lp = parseLogpointSpec(spec, this.pathOptions);
    this.addBreakpointSpec(lp);
    return lp;
  }

  /**
   * Add a breakpoint from a spec object
   */
  addBreakpointSpec(spec: BreakpointSpec): void {
    const existing = this.breakpoints.get(spec.file) || [];
    existing.push({
      ...spec,
      verified: false,
    });
    this.breakpoints.set(spec.file, existing);
  }

  /**
   * Set all breakpoints on the debug adapter
   */
  async setAllBreakpoints(): Promise<void> {
    for (const [file, specs] of this.breakpoints) {
      await this.setFileBreakpoints(file, specs);
    }
  }

  /**
   * Set breakpoints for a single file
   */
  private async setFileBreakpoints(file: string, specs: TrackedBreakpoint[]): Promise<void> {
    const sourceBreakpoints: SourceBreakpoint[] = specs.map((spec) => ({
      line: spec.line,
      condition: spec.condition,
      hitCondition: spec.hitCondition,
      logMessage: spec.logMessage,
    }));

    try {
      const response = await this.client.setBreakpoints({
        source: { path: file },
        breakpoints: sourceBreakpoints,
      });

      // Update tracked breakpoints with response
      for (let i = 0; i < specs.length; i++) {
        const bp = response.breakpoints[i];
        if (bp) {
          specs[i].id = bp.id ?? this.nextId++;
          specs[i].verified = bp.verified;
          specs[i].message = bp.message;
          specs[i].line = bp.line ?? specs[i].line;

          // Emit breakpoint_set event
          this.formatter.breakpointSet(
            specs[i].id!,
            file,
            specs[i].line,
            specs[i].verified,
            specs[i].condition,
            specs[i].message
          );
        }
      }
    } catch (error) {
      // Emit error for each breakpoint that failed
      for (const spec of specs) {
        spec.id = this.nextId++;
        spec.verified = false;
        spec.message = error instanceof Error ? error.message : 'Failed to set breakpoint';

        this.formatter.breakpointSet(spec.id, file, spec.line, false, spec.condition, spec.message);
      }
    }
  }

  /**
   * Get all tracked breakpoints
   */
  getAllBreakpoints(): TrackedBreakpoint[] {
    const all: TrackedBreakpoint[] = [];
    for (const specs of this.breakpoints.values()) {
      all.push(...specs);
    }
    return all;
  }

  /**
   * Find a breakpoint by ID
   */
  findBreakpointById(id: number): TrackedBreakpoint | undefined {
    for (const specs of this.breakpoints.values()) {
      const found = specs.find((bp) => bp.id === id);
      if (found) return found;
    }
    return undefined;
  }

  /**
   * Get the count of breakpoints that were hit
   */
  getHitCount(): number {
    // This would need to be tracked during the session
    // For now, return 0
    return 0;
  }
}
