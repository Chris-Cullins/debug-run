/**
 * Base Adapter Interface
 *
 * Defines the contract for debug adapter configurations.
 */

import type { LaunchRequestArguments, AttachRequestArguments } from "../dap/protocol.js";

export interface LaunchOptions {
  program: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stopAtEntry?: boolean;
}

export interface AttachOptions {
  pid?: number;
  processName?: string;
  host?: string;
  port?: number;
}

export type TransportType = "stdio" | "socket";

export interface AdapterConfig {
  /** DAP adapter ID (e.g., "coreclr", "python") */
  id: string;

  /** Human-readable name */
  name: string;

  /** Command to spawn the debug adapter */
  command: string;

  /** Arguments for the command */
  args?: string[];

  /** Transport type: "stdio" (default) or "socket" */
  transport?: TransportType;

  /** Port for socket transport (required if transport is "socket") */
  socketPort?: number;

  /**
   * Requires launch/attach before breakpoints can be set.
   * Some adapters (like debugpy) don't send the 'initialized' event
   * until after launch is called, requiring a different DAP flow.
   */
  requiresLaunchFirst?: boolean;

  /** Function to detect if the adapter is installed */
  detect: () => Promise<string | null>;

  /** Instructions for installing the adapter */
  installHint: string;

  /** Build launch configuration for the adapter */
  launchConfig: (options: LaunchOptions) => LaunchRequestArguments;

  /** Build attach configuration for the adapter */
  attachConfig: (options: AttachOptions) => AttachRequestArguments;

  /** Exception breakpoint filters supported by this adapter */
  exceptionFilters?: string[];
}

/**
 * Check if a command exists in PATH
 */
export async function commandExists(command: string): Promise<string | null> {
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(exec);

  try {
    const cmd = process.platform === "win32" ? `where ${command}` : `which ${command}`;
    const { stdout } = await execAsync(cmd);
    return stdout.trim().split("\n")[0] || null;
  } catch {
    return null;
  }
}
