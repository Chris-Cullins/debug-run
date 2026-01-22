/**
 * CLI Interface
 *
 * Argument parsing and command handling using Commander.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { Command, Option } from 'commander';
import { getAdapter, getAdapterNames } from './adapters/index.js';
import { DebugSession } from './session/manager.js';
import { OutputFormatter } from './output/formatter.js';
import {
  installNetcoredbg,
  isNetcoredbgInstalled,
  getNetcoredbgPath,
  installJsDebug,
  isJsDebugInstalled,
  getJsDebugPath,
} from './util/adapter-installer.js';
import { launchTestRunner, cleanupTestRunner, type TestRunnerResult } from './util/test-runner.js';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');
const VERSION = packageJson.version;
import { validateAllBreakpoints } from './session/breakpoints.js';
import { parseSourceMapOverrides, getPresetNames } from './sourcemaps/overrides.js';
import { diagnoseSourceMaps, formatDiagnoseReport } from './sourcemaps/diagnose.js';

export interface CliOptions {
  adapter: string;
  program?: string;
  args?: string[];
  cwd?: string;
  breakpoint: string[];
  logpoint: string[];
  eval: string[];
  assert: string[];
  breakOnException?: string[];
  timeout?: string;
  captureLocals?: boolean;
  pretty?: boolean;
  steps?: number;
  captureEachStep?: boolean;
  attach?: boolean;
  pid?: number;
  trace?: boolean;
  traceInto?: boolean;
  traceLimit?: number;
  traceUntil?: string;
  diffVars?: boolean;
  evalAfterStep?: boolean;
  output?: string;
  include?: string[];
  exclude?: string[];
  // Test runner options
  testProject?: string;
  testFilter?: string;
  // Token efficiency options
  compactServices?: boolean;
  expandServices?: boolean;
  showNullProps?: boolean;
  noDedupe?: boolean;
  // Exception handling options
  flattenExceptions?: boolean;
  exceptionChainDepth?: number;
  // Compact output mode
  compact?: boolean;
  stackLimit?: number;
  // Source map options
  sourceMapOverrides?: string;
}

export function parseTimeout(value: string): number {
  const match = value.match(/^(\d+)(ms|s|m)?$/);
  if (!match) {
    throw new Error(`Invalid timeout format: ${value}. Use format like "30s", "5000ms", or "2m"`);
  }

  const num = parseInt(match[1], 10);
  const unit = match[2] || 'ms';

  switch (unit) {
    case 'ms':
      return num;
    case 's':
      return num * 1000;
    case 'm':
      return num * 60 * 1000;
    default:
      return num;
  }
}

export function createCli(): Command {
  const program = new Command();

  program
    .name('debug-run')
    .description('CLI tool enabling AI agents to programmatically debug code via DAP')
    .version(VERSION);

  // Main debug command (default)
  program
    .argument('[program]', 'Program to debug')
    .option('-a, --adapter <name>', `Debug adapter to use (${getAdapterNames().join(', ')})`)
    .option('--args <args...>', 'Arguments to pass to the program')
    .option('--cwd <path>', 'Working directory for the program')
    .option(
      '-b, --breakpoint <spec...>',
      'Breakpoint specifications (e.g., "file.ts:45" or "file.ts:45?condition")',
      []
    )
    .option('-e, --eval <expr...>', 'Expressions to evaluate when breakpoints are hit', [])
    .option(
      '--assert <expr...>',
      'Invariant expressions that must remain truthy; stops on first violation',
      []
    )
    .option(
      '-l, --logpoint <spec...>',
      'Logpoint specifications (e.g., "file.ts:45|log message with {expr}")',
      []
    )
    .option(
      '--break-on-exception <filter...>',
      'Break on exceptions (e.g., "all", "user-unhandled", "uncaught")'
    )
    .option('-t, --timeout <duration>', 'Session timeout (e.g., 30s, 5000ms, 2m)', '60s')
    .option('--capture-locals', 'Capture local variables at breakpoints', true)
    .option('--no-capture-locals', 'Disable capturing local variables')
    .option('--pretty', 'Pretty print JSON output', false)
    .option(
      '-s, --steps <count>',
      'Number of steps to execute after hitting a breakpoint (step over)',
      (val: string) => parseInt(val, 10)
    )
    .option('--capture-each-step', 'Capture variables and location at each step', false)
    .option('--trace', 'Enable trace mode - step through code after breakpoint hit', false)
    .option(
      '--trace-into',
      'Use stepIn instead of stepOver in trace mode (follow into function calls)',
      false
    )
    .option(
      '--trace-limit <count>',
      'Maximum steps in trace mode before stopping (default: 500)',
      (val: string) => parseInt(val, 10),
      500
    )
    .option('--trace-until <expr>', 'Stop trace when expression evaluates to truthy')
    .option(
      '--diff-vars',
      'Show only changed variables in trace steps instead of full dumps',
      false
    )
    .option(
      '--eval-after-step',
      'Step once before evaluating expressions (useful for evaluating variables being assigned on the breakpoint line)',
      false
    )
    .option('-o, --output <file>', 'Write events to file instead of stdout')
    .option('--include <types...>', 'Only emit these event types (e.g., breakpoint_hit error)')
    .option(
      '--exclude <types...>',
      'Suppress these event types (e.g., program_output exception_thrown)'
    )
    .addOption(new Option('--env <key=value...>', 'Environment variables for the program'))
    .option('--attach', 'Attach to a running process instead of launching', false)
    .option('--pid <processId>', 'Process ID to attach to (requires --attach)', (val: string) =>
      parseInt(val, 10)
    )
    .option(
      '--test-project <path>',
      'Run dotnet test with VSTEST_HOST_DEBUG=1 and auto-attach (for NUnit/xUnit/MSTest)'
    )
    .option('--test-filter <filter>', 'Filter which tests to run (passed to dotnet test --filter)')
    // Token efficiency options
    .option(
      '--expand-services',
      'Fully expand service-like types (Logger, Repository, etc.) instead of showing compact form',
      false
    )
    .option(
      '--show-null-props',
      'Include null/undefined properties in output (normally omitted for token efficiency)',
      false
    )
    .option('--no-dedupe', 'Disable content-based deduplication of repeated objects', false)
    // Exception handling options
    .option(
      '--flatten-exceptions',
      'Enable exception chain flattening and root cause classification (default: true)',
      true
    )
    .option(
      '--no-flatten-exceptions',
      'Disable exception chain flattening and root cause classification'
    )
    .option(
      '--exception-chain-depth <depth>',
      'Maximum depth to traverse exception chain (default: 10)',
      (val: string) => parseInt(val, 10),
      10
    )
    // Compact output mode
    .option(
      '--compact',
      'Enable compact output mode for reduced token usage (limits stack traces, filters internals, abbreviates paths)',
      false
    )
    .option(
      '--stack-limit <count>',
      'Maximum stack frames to include (default: 3 in compact mode, unlimited otherwise)',
      (val: string) => parseInt(val, 10)
    )
    // Source map options
    .option(
      '--source-map-overrides <jsonOrPreset>',
      'Source map path overrides for TypeScript/bundled code. Use preset names (webpack, vite, esbuild) or JSON object'
    )
    .action(
      async (
        programPath: string | undefined,
        options: Omit<CliOptions, 'program'> & {
          env?: string[];
          adapter?: string;
          logpoint?: string[];
          breakOnException?: string[];
          attach?: boolean;
          pid?: number;
          testProject?: string;
          testFilter?: string;
          expandServices?: boolean;
          showNullProps?: boolean;
          noDedupe?: boolean;
          flattenExceptions?: boolean;
          exceptionChainDepth?: number;
          compact?: boolean;
          stackLimit?: number;
          sourceMapOverrides?: string;
        }
      ) => {
        // Handle test runner mode
        if (options.testProject) {
          // Test runner mode - automatically implies attach mode
          if (!options.adapter) {
            // Default to vsdbg for .NET tests
            options.adapter = 'vsdbg';
          }
          await runTestDebugSession({ ...options, program: programPath, adapter: options.adapter });
          return;
        }

        // Validate attach mode
        if (options.attach) {
          if (!options.pid) {
            console.error('Error: --pid is required when using --attach');
            console.error(
              'Usage: debug-run --attach --pid <processId> -a <adapter> -b <breakpoint>'
            );
            process.exit(1);
          }
        } else {
          // Launch mode requires a program
          if (!programPath) {
            console.error(
              'Error: <program> argument is required (or use --attach --pid, or --test-project)'
            );
            console.error('Usage: debug-run <program> -a <adapter> -b <breakpoint>');
            process.exit(1);
          }
        }

        if (!options.adapter) {
          console.error('Error: --adapter is required');
          console.error(`Available adapters: ${getAdapterNames().join(', ')}`);
          process.exit(1);
        }

        // Validate breakpoint and logpoint formats before starting session
        const breakpointErrors = validateAllBreakpoints(
          options.breakpoint || [],
          options.logpoint || []
        );
        if (breakpointErrors.length > 0) {
          for (const error of breakpointErrors) {
            console.error(`Error: ${error}`);
          }
          process.exit(1);
        }

        await runDebugSession({ ...options, program: programPath, adapter: options.adapter });
      }
    );

  // Add list-adapters subcommand
  program
    .command('list-adapters')
    .description('List available debug adapters and their installation status')
    .action(async () => {
      await listAdapters();
    });

  // Add install-adapter subcommand
  program
    .command('install-adapter <name>')
    .description('Download and install a debug adapter')
    .action(async (name: string) => {
      await installAdapter(name);
    });

  // Add install-skill subcommand
  program
    .command('install-skill')
    .description('Install the debug-run skill for AI coding assistants')
    .option('--claude', 'Install to Claude Code (~/.claude/skills/)')
    .option('--copilot', 'Install to GitHub Copilot (~/.copilot/skills/)')
    .option('--project', 'Install to project directory instead of user home')
    .option('--dir <path>', 'Install to custom directory')
    .action(
      async (options: { claude?: boolean; copilot?: boolean; project?: boolean; dir?: string }) => {
        await installSkill(options);
      }
    );

  // Add diagnose-sources subcommand (Phase 3)
  program
    .command('diagnose-sources [directory]')
    .description('Scan directory for source maps and diagnose path resolution issues')
    .option(
      '--source-map-overrides <jsonOrPreset>',
      'Source map path overrides (preset name or JSON object)'
    )
    .option('--include-node-modules', 'Include node_modules in scan', false)
    .option('--verbose', 'Show detailed per-file diagnostics', false)
    .option('--json', 'Output as JSON instead of human-readable format', false)
    .action(
      async (
        directory: string | undefined,
        options: {
          sourceMapOverrides?: string;
          includeNodeModules?: boolean;
          verbose?: boolean;
          json?: boolean;
        }
      ) => {
        const targetDir = directory ? path.resolve(directory) : process.cwd();

        if (!fs.existsSync(targetDir)) {
          console.error(`Error: Directory not found: ${targetDir}`);
          process.exit(1);
        }

        let sourceMapOverrides: Record<string, string> | undefined;
        if (options.sourceMapOverrides) {
          try {
            sourceMapOverrides = parseSourceMapOverrides(options.sourceMapOverrides, targetDir);
          } catch (error) {
            console.error(`Error: ${error instanceof Error ? error.message : error}`);
            console.error(`Available presets: ${getPresetNames().join(', ')}`);
            process.exit(1);
          }
        }

        const result = diagnoseSourceMaps(targetDir, {
          sourceMapOverrides,
          includeNodeModules: options.includeNodeModules,
          verbose: options.verbose,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(formatDiagnoseReport(result, options.verbose || false));
        }

        if (result.summary.sourcesMissing > 0) {
          process.exit(1);
        }
      }
    );

  return program;
}

/**
 * Run a debug session for .NET tests using the test runner.
 * Automatically launches dotnet test with VSTEST_HOST_DEBUG=1 and attaches.
 */
async function runTestDebugSession(options: CliOptions & { env?: string[] }): Promise<void> {
  // Validate adapter
  const adapter = getAdapter(options.adapter);
  if (!adapter) {
    console.error(`Unknown adapter: ${options.adapter}`);
    console.error(`Available adapters: ${getAdapterNames().join(', ')}`);
    process.exit(1);
  }

  // Check if adapter is installed
  const adapterPath = await adapter.detect();
  if (!adapterPath) {
    console.error(`Adapter "${adapter.name}" is not installed.`);
    console.error(adapter.installHint);
    process.exit(1);
  }

  // Validate breakpoints
  if (options.breakpoint.length === 0) {
    console.error('Error: At least one --breakpoint is required for test debugging');
    console.error('Example: -b "path/to/TestFile.cs:42"');
    process.exit(1);
  }

  // Validate breakpoint and logpoint formats
  const breakpointErrors = validateAllBreakpoints(options.breakpoint || [], options.logpoint || []);
  if (breakpointErrors.length > 0) {
    for (const error of breakpointErrors) {
      console.error(`Error: ${error}`);
    }
    process.exit(1);
  }

  console.error(`Starting test runner for: ${options.testProject}`);
  if (options.testFilter) {
    console.error(`Test filter: ${options.testFilter}`);
  }

  let testRunner: TestRunnerResult | null = null;

  try {
    // Launch the test runner and get the PID
    testRunner = await launchTestRunner({
      testProject: options.testProject!,
      filter: options.testFilter,
      cwd: options.cwd,
      onProgress: (msg) => console.error(msg),
    });

    console.error(`\nTesthost process started with PID: ${testRunner.pid}`);
    console.error('Attaching debugger...\n');

    // Now run the debug session in attach mode with the discovered PID
    await runDebugSession({
      ...options,
      attach: true,
      pid: testRunner.pid,
    });
  } finally {
    // Clean up the test runner process
    if (testRunner) {
      cleanupTestRunner(testRunner.process);
    }
  }
}

async function runDebugSession(options: CliOptions & { env?: string[] }): Promise<void> {
  // Validate adapter
  const adapter = getAdapter(options.adapter);
  if (!adapter) {
    console.error(`Unknown adapter: ${options.adapter}`);
    console.error(`Available adapters: ${getAdapterNames().join(', ')}`);
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
  const hasBreakpoints =
    options.breakpoint.length > 0 || (options.logpoint && options.logpoint.length > 0);
  const hasExceptionBreakpoints = options.breakOnException && options.breakOnException.length > 0;

  // In attach mode, breakpoints are optional (you might just want to break on exceptions)
  if (!hasBreakpoints && !hasExceptionBreakpoints && !options.attach) {
    console.error(
      'Error: At least one --breakpoint, --logpoint, or --break-on-exception is required'
    );
    process.exit(1);
  }

  // Validate exception breakpoint filters against adapter's supported filters
  if (hasExceptionBreakpoints && adapter.exceptionFilters) {
    for (const filter of options.breakOnException!) {
      if (!adapter.exceptionFilters.includes(filter)) {
        console.error(
          `Error: Adapter "${adapter.name}" does not support exception filter "${filter}"`
        );
        console.error(`Supported filters: ${adapter.exceptionFilters.join(', ')}`);
        process.exit(1);
      }
    }
  }

  // Parse environment variables
  const env: Record<string, string> = {};
  if (options.env) {
    for (const item of options.env) {
      const [key, ...valueParts] = item.split('=');
      if (key && valueParts.length > 0) {
        env[key] = valueParts.join('=');
      }
    }
  }

  // Parse timeout
  const timeout = parseTimeout(options.timeout || '60s');

  // Parse source map overrides
  let sourceMapOverrides: Record<string, string> | undefined;
  if (options.sourceMapOverrides) {
    const workspaceFolder = options.cwd || process.cwd();
    try {
      sourceMapOverrides = parseSourceMapOverrides(options.sourceMapOverrides, workspaceFolder);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : error}`);
      console.error(`Available presets: ${getPresetNames().join(', ')}`);
      process.exit(1);
    }
  }

  // Create output stream (file or stdout)
  let outputStream: NodeJS.WritableStream = process.stdout;
  let fileStream: fs.WriteStream | undefined;

  if (options.output) {
    fileStream = fs.createWriteStream(options.output);
    outputStream = fileStream;
  }

  // Create formatter with filtering options
  const formatter = new OutputFormatter({
    pretty: options.pretty,
    stream: outputStream,
    include: options.include,
    exclude: options.exclude,
    compact: options.compact,
    stackLimit: options.stackLimit,
  });

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
      assertions: options.assert.length > 0 ? options.assert : undefined,
      timeout,
      captureLocals: options.captureLocals,
      steps: options.steps,
      captureEachStep: options.captureEachStep,
      attach: options.attach,
      pid: options.pid,
      trace: options.trace,
      traceInto: options.traceInto,
      traceLimit: options.traceLimit,
      traceUntil: options.traceUntil,
      diffVars: options.diffVars,
      evalAfterStep: options.evalAfterStep,
      // Token efficiency options
      expandServices: options.expandServices,
      showNullProps: options.showNullProps,
      noDedupe: options.noDedupe,
      // Exception handling options
      flattenExceptions: options.flattenExceptions,
      exceptionChainDepth: options.exceptionChainDepth,
      // Source map options
      sourceMapOverrides,
    },
    formatter
  );

  try {
    await session.run();
  } catch {
    process.exit(1);
  } finally {
    // Close file stream if we created one
    if (fileStream) {
      fileStream.end();
    }
  }
}

async function listAdapters(): Promise<void> {
  console.log('Available debug adapters:\n');

  for (const name of getAdapterNames()) {
    const adapter = getAdapter(name);
    if (!adapter) continue;

    const path = await adapter.detect();
    const status = path ? `✓ installed (${path})` : '✗ not installed';

    console.log(`  ${adapter.name}`);
    console.log(`    ID: ${adapter.id}`);
    console.log(`    Status: ${status}`);
    console.log();
  }
}

async function installAdapter(name: string): Promise<void> {
  const normalizedName = name.toLowerCase();

  if (
    normalizedName === 'netcoredbg' ||
    normalizedName === 'coreclr' ||
    normalizedName === 'dotnet'
  ) {
    if (isNetcoredbgInstalled()) {
      console.log(`netcoredbg is already installed at: ${getNetcoredbgPath()}`);
      return;
    }

    try {
      const installedPath = await installNetcoredbg((msg) => console.log(msg));
      console.log(`\nSuccessfully installed netcoredbg!`);
      console.log(`Path: ${installedPath}`);
    } catch (error) {
      console.error(
        `Failed to install netcoredbg: ${error instanceof Error ? error.message : error}`
      );
      process.exit(1);
    }
  } else if (
    normalizedName === 'node' ||
    normalizedName === 'nodejs' ||
    normalizedName === 'js' ||
    normalizedName === 'javascript' ||
    normalizedName === 'typescript'
  ) {
    if (isJsDebugInstalled()) {
      console.log(`js-debug is already installed at: ${getJsDebugPath()}`);
      return;
    }

    try {
      const installedPath = await installJsDebug((msg) => console.log(msg));
      console.log(`\nSuccessfully installed js-debug!`);
      console.log(`Path: ${installedPath}`);
    } catch (error) {
      console.error(
        `Failed to install js-debug: ${error instanceof Error ? error.message : error}`
      );
      process.exit(1);
    }
  } else if (normalizedName === 'debugpy' || normalizedName === 'python') {
    console.log('debugpy should be installed via pip:');
    console.log('  pip install debugpy');
    console.log('\nOr:');
    console.log('  pip3 install debugpy');
  } else {
    console.error(`Unknown adapter: ${name}`);
    console.error(`Available adapters: ${getAdapterNames().join(', ')}`);
    process.exit(1);
  }
}

interface InstallSkillOptions {
  claude?: boolean;
  copilot?: boolean;
  project?: boolean;
  dir?: string;
}

interface SkillTarget {
  name: string;
  directory: string;
}

function getSkillTargets(options: InstallSkillOptions): SkillTarget[] {
  const os = require('node:os');
  const path = require('node:path');

  const homeDir = os.homedir();
  const projectDir = process.cwd();
  const targets: SkillTarget[] = [];

  // If custom directory specified, use only that
  if (options.dir) {
    targets.push({
      name: 'custom',
      directory: path.resolve(options.dir, 'debug-run'),
    });
    return targets;
  }

  // Determine which targets to install to
  const installClaude = options.claude || (!options.copilot && !options.dir);
  const installCopilot = options.copilot;

  if (installClaude) {
    if (options.project) {
      targets.push({
        name: 'Claude Code (project)',
        directory: path.join(projectDir, '.claude', 'skills', 'debug-run'),
      });
    } else {
      targets.push({
        name: 'Claude Code',
        directory: path.join(homeDir, '.claude', 'skills', 'debug-run'),
      });
    }
  }

  if (installCopilot) {
    if (options.project) {
      // Copilot recommends .github/skills/ for project skills
      targets.push({
        name: 'GitHub Copilot (project)',
        directory: path.join(projectDir, '.github', 'skills', 'debug-run'),
      });
    } else {
      targets.push({
        name: 'GitHub Copilot',
        directory: path.join(homeDir, '.copilot', 'skills', 'debug-run'),
      });
    }
  }

  return targets;
}

async function installSkill(options: InstallSkillOptions = {}): Promise<void> {
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  // Find the skill source directory (relative to this module)
  // Use fileURLToPath for cross-platform compatibility (Windows needs this)
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  // In built version, we're in dist/, skills are in ../.claude/skills/
  // Try multiple possible locations
  const possibleSources = [
    path.join(moduleDir, '..', '.claude', 'skills', 'debug-run'),
    path.join(moduleDir, '.claude', 'skills', 'debug-run'),
    path.join(process.cwd(), '.claude', 'skills', 'debug-run'),
  ];

  let sourceDir: string | null = null;
  for (const src of possibleSources) {
    if (fs.existsSync(path.join(src, 'SKILL.md'))) {
      sourceDir = src;
      break;
    }
  }

  if (!sourceDir) {
    console.error('Error: Could not find skill files.');
    console.error('Expected to find SKILL.md in .claude/skills/debug-run/');
    process.exit(1);
  }

  // Get target directories based on options
  const targets = getSkillTargets(options);

  if (targets.length === 0) {
    console.error('Error: No installation target specified.');
    console.error('Use --claude, --copilot, --project, or --dir <path>');
    process.exit(1);
  }

  // Copy skill files
  const files = ['SKILL.md', 'DOTNET.md', 'PYTHON.md', 'TYPESCRIPT.md'];

  for (const target of targets) {
    // Create target directory
    fs.mkdirSync(target.directory, { recursive: true });

    let copiedCount = 0;
    for (const file of files) {
      const srcPath = path.join(sourceDir, file);
      const destPath = path.join(target.directory, file);

      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        copiedCount++;
      }
    }

    console.log(`Installed debug-run skill for ${target.name}:`);
    console.log(`  Directory: ${target.directory}`);
    console.log(`  Files copied: ${copiedCount}`);
    for (const file of files) {
      if (fs.existsSync(path.join(target.directory, file))) {
        console.log(`    - ${file}`);
      }
    }
    console.log();
  }

  // Print usage hints based on targets
  const targetNames = targets.map((t) => t.name);
  if (targetNames.some((n) => n.includes('Claude'))) {
    console.log('Claude Code will now use this skill when debugging.');
  }
  if (targetNames.some((n) => n.includes('Copilot'))) {
    console.log('GitHub Copilot will now use this skill when debugging.');
    console.log(
      'Note: Enable the chat.useAgentSkills setting in VS Code for Agent Skills support.'
    );
  }
}
