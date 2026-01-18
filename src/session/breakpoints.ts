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
  /** Program path - fallback base for relative paths (uses dirname) */
  programPath?: string;
}

/**
 * Resolve a breakpoint file path.
 *
 * Resolution order:
 * 1. If file is absolute, use as-is
 * 2. If cwd is provided, resolve relative to cwd (most intuitive for users)
 * 3. If programPath is provided, resolve relative to its directory
 * 4. Default: resolve against process.cwd()
 *
 * This allows users to specify breakpoints like "src/file.ts:3" relative to
 * their project root (cwd), or "test.js:3" relative to the program location.
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

  // Fall back to program directory
  if (options.programPath) {
    const programDir = path.dirname(options.programPath);
    return path.resolve(programDir, file);
  }

  // Default: resolve against process cwd
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
