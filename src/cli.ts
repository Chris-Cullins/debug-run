/**
 * CLI Interface
 *
 * Argument parsing and command handling using Commander.
 */

import { Command, Option } from "commander";
import { getAdapter, getAdapterNames } from "./adapters/index.js";
import { DebugSession } from "./session/manager.js";
import { OutputFormatter } from "./output/formatter.js";
import { installNetcoredbg, isNetcoredbgInstalled, getNetcoredbgPath } from "./util/adapter-installer.js";

export interface CliOptions {
  adapter: string;
  program?: string;
  args?: string[];
  cwd?: string;
  breakpoint: string[];
  logpoint: string[];
  eval: string[];
  breakOnException?: string[];
  timeout?: string;
  captureLocals?: boolean;
  pretty?: boolean;
  steps?: number;
  captureEachStep?: boolean;
  attach?: boolean;
  pid?: number;
}

function parseTimeout(value: string): number {
  const match = value.match(/^(\d+)(ms|s|m)?$/);
  if (!match) {
    throw new Error(`Invalid timeout format: ${value}. Use format like "30s", "5000ms", or "2m"`);
  }

  const num = parseInt(match[1], 10);
  const unit = match[2] || "ms";

  switch (unit) {
    case "ms":
      return num;
    case "s":
      return num * 1000;
    case "m":
      return num * 60 * 1000;
    default:
      return num;
  }
}

export function createCli(): Command {
  const program = new Command();

  program
    .name("debug-run")
    .description("CLI tool enabling AI agents to programmatically debug code via DAP")
    .version("0.1.0");

  // Main debug command (default)
  program
    .argument("[program]", "Program to debug")
    .option(
      "-a, --adapter <name>",
      `Debug adapter to use (${getAdapterNames().join(", ")})`
    )
    .option("--args <args...>", "Arguments to pass to the program")
    .option("--cwd <path>", "Working directory for the program")
    .option(
      "-b, --breakpoint <spec...>",
      'Breakpoint specifications (e.g., "file.ts:45" or "file.ts:45?condition")',
      []
    )
    .option(
      "-e, --eval <expr...>",
      "Expressions to evaluate when breakpoints are hit",
      []
    )
    .option(
      "-l, --logpoint <spec...>",
      'Logpoint specifications (e.g., "file.ts:45|log message with {expr}")',
      []
    )
    .option(
      "--break-on-exception <filter...>",
      'Break on exceptions (e.g., "all", "user-unhandled", "uncaught")'
    )
    .option(
      "-t, --timeout <duration>",
      "Session timeout (e.g., 30s, 5000ms, 2m)",
      "60s"
    )
    .option("--capture-locals", "Capture local variables at breakpoints", true)
    .option("--no-capture-locals", "Disable capturing local variables")
    .option("--pretty", "Pretty print JSON output", false)
    .option(
      "-s, --steps <count>",
      "Number of steps to execute after hitting a breakpoint (step over)",
      (val: string) => parseInt(val, 10)
    )
    .option(
      "--capture-each-step",
      "Capture variables and location at each step",
      false
    )
    .addOption(
      new Option("--env <key=value...>", "Environment variables for the program")
    )
    .option(
      "--attach",
      "Attach to a running process instead of launching",
      false
    )
    .option(
      "--pid <processId>",
      "Process ID to attach to (requires --attach)",
      (val: string) => parseInt(val, 10)
    )
    .action(async (programPath: string | undefined, options: Omit<CliOptions, "program"> & { env?: string[]; adapter?: string; logpoint?: string[]; breakOnException?: string[]; attach?: boolean; pid?: number }) => {
      // Validate attach mode
      if (options.attach) {
        if (!options.pid) {
          console.error("Error: --pid is required when using --attach");
          console.error("Usage: debug-run --attach --pid <processId> -a <adapter> -b <breakpoint>");
          process.exit(1);
        }
      } else {
        // Launch mode requires a program
        if (!programPath) {
          console.error("Error: <program> argument is required (or use --attach --pid)");
          console.error("Usage: debug-run <program> -a <adapter> -b <breakpoint>");
          process.exit(1);
        }
      }

      if (!options.adapter) {
        console.error("Error: --adapter is required");
        console.error(`Available adapters: ${getAdapterNames().join(", ")}`);
        process.exit(1);
      }
      await runDebugSession({ ...options, program: programPath, adapter: options.adapter });
    });

  // Add list-adapters subcommand
  program
    .command("list-adapters")
    .description("List available debug adapters and their installation status")
    .action(async () => {
      await listAdapters();
    });

  // Add install-adapter subcommand
  program
    .command("install-adapter <name>")
    .description("Download and install a debug adapter")
    .action(async (name: string) => {
      await installAdapter(name);
    });

  return program;
}

async function runDebugSession(options: CliOptions & { env?: string[] }): Promise<void> {
  // Validate adapter
  const adapter = getAdapter(options.adapter);
  if (!adapter) {
    console.error(`Unknown adapter: ${options.adapter}`);
    console.error(`Available adapters: ${getAdapterNames().join(", ")}`);
    process.exit(1);
  }

  // Check if adapter is installed
  const adapterPath = await adapter.detect();
  if (!adapterPath) {
    console.error(`Adapter "${adapter.name}" is not installed.`);
    console.error(adapter.installHint);
    process.exit(1);
  }

  // Validate breakpoints (or exception breakpoints must be specified)
  const hasBreakpoints = options.breakpoint.length > 0 || (options.logpoint && options.logpoint.length > 0);
  const hasExceptionBreakpoints = options.breakOnException && options.breakOnException.length > 0;

  // In attach mode, breakpoints are optional (you might just want to break on exceptions)
  if (!hasBreakpoints && !hasExceptionBreakpoints && !options.attach) {
    console.error("Error: At least one --breakpoint, --logpoint, or --break-on-exception is required");
    process.exit(1);
  }

  // Validate exception breakpoint filters against adapter's supported filters
  if (hasExceptionBreakpoints && adapter.exceptionFilters) {
    for (const filter of options.breakOnException!) {
      if (!adapter.exceptionFilters.includes(filter)) {
        console.error(`Error: Adapter "${adapter.name}" does not support exception filter "${filter}"`);
        console.error(`Supported filters: ${adapter.exceptionFilters.join(", ")}`);
        process.exit(1);
      }
    }
  }

  // Parse environment variables
  const env: Record<string, string> = {};
  if (options.env) {
    for (const item of options.env) {
      const [key, ...valueParts] = item.split("=");
      if (key && valueParts.length > 0) {
        env[key] = valueParts.join("=");
      }
    }
  }

  // Parse timeout
  const timeout = parseTimeout(options.timeout || "60s");

  // Create formatter
  const formatter = new OutputFormatter({ pretty: options.pretty });

  // Create and run session
  const session = new DebugSession(
    {
      adapter,
      program: options.program,
      args: options.args,
      cwd: options.cwd,
      env: Object.keys(env).length > 0 ? env : undefined,
      breakpoints: options.breakpoint,
      logpoints: options.logpoint && options.logpoint.length > 0 ? options.logpoint : undefined,
      exceptionFilters: options.breakOnException,
      evaluations: options.eval.length > 0 ? options.eval : undefined,
      timeout,
      captureLocals: options.captureLocals,
      steps: options.steps,
      captureEachStep: options.captureEachStep,
      attach: options.attach,
      pid: options.pid,
    },
    formatter
  );

  try {
    await session.run();
  } catch {
    process.exit(1);
  }
}

async function listAdapters(): Promise<void> {
  console.log("Available debug adapters:\n");

  for (const name of getAdapterNames()) {
    const adapter = getAdapter(name);
    if (!adapter) continue;

    const path = await adapter.detect();
    const status = path ? `✓ installed (${path})` : "✗ not installed";

    console.log(`  ${adapter.name}`);
    console.log(`    ID: ${adapter.id}`);
    console.log(`    Status: ${status}`);
    console.log();
  }
}

async function installAdapter(name: string): Promise<void> {
  const normalizedName = name.toLowerCase();

  if (normalizedName === "netcoredbg" || normalizedName === "coreclr" || normalizedName === "dotnet") {
    if (isNetcoredbgInstalled()) {
      console.log(`netcoredbg is already installed at: ${getNetcoredbgPath()}`);
      return;
    }

    try {
      const installedPath = await installNetcoredbg((msg) => console.log(msg));
      console.log(`\nSuccessfully installed netcoredbg!`);
      console.log(`Path: ${installedPath}`);
    } catch (error) {
      console.error(`Failed to install netcoredbg: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  } else if (normalizedName === "debugpy" || normalizedName === "python") {
    console.log("debugpy should be installed via pip:");
    console.log("  pip install debugpy");
    console.log("\nOr:");
    console.log("  pip3 install debugpy");
  } else {
    console.error(`Unknown adapter: ${name}`);
    console.error(`Available adapters: ${getAdapterNames().join(", ")}`);
    process.exit(1);
  }
}
