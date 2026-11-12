import { Command, Option } from 'commander';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { ControlError, type LiveCommand } from './controller.js';
import { DEFAULT_LIFETIME_MS, errorResult } from './protocol.js';
import { sendCommand } from './client.js';
import { runWorker, type StartOptions } from './worker.js';
import { getAdapter } from '../adapters/index.js';

interface CliStartOptions {
  adapter: string;
  cwd?: string;
  args: string[];
  breakpoint: string[];
  breakOnException: string[];
  env: string[];
  timeout: string;
  attach?: boolean;
  pid?: string;
  port?: string;
  stopAtEntry?: boolean;
  sourceMapOverrides?: string;
}

function numberOption(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new ControlError('INVALID_ARGUMENT', `${name} must be a nonnegative integer.`);
  }
  return Number(value);
}

export function lifetime(value: string): number {
  const match = /^(\d+)(ms|s|m)?$/.exec(value);
  const duration = match
    ? Number(match[1]) * (match[2] === 'm' ? 60000 : match[2] === 's' ? 1000 : 1)
    : NaN;
  if (!Number.isSafeInteger(duration) || duration < 1000 || duration > 3600000) {
    throw new ControlError('INVALID_ARGUMENT', 'Session timeout must be between 1s and 60m.');
  }
  return duration;
}

async function normalizeStart(
  program: string | undefined,
  options: CliStartOptions
): Promise<StartOptions> {
  const cwd = resolve(options.cwd ?? process.cwd());
  if (!(await stat(cwd)).isDirectory())
    throw new ControlError('INVALID_ARGUMENT', 'Working directory is not a directory.');
  const pid = numberOption(options.pid, '--pid');
  const port = numberOption(options.port, '--port');
  if (port !== undefined && (port < 1 || port > 65535)) {
    throw new ControlError('INVALID_ARGUMENT', 'Inspector port must be between 1 and 65535.');
  }
  if (options.attach && (program || (!pid && !port) || (pid !== undefined && port !== undefined))) {
    throw new ControlError(
      'INVALID_ARGUMENT',
      'Attach requires exactly one of --pid or --port and no program.'
    );
  }
  if (!options.attach && (!program || pid !== undefined || port !== undefined)) {
    throw new ControlError(
      'INVALID_ARGUMENT',
      'Provide a program, or use --attach with --pid/--port.'
    );
  }
  const isNode = getAdapter(options.adapter)?.name === 'node';
  if (options.attach && isNode && !port) {
    throw new ControlError(
      'UNSUPPORTED_ATTACH',
      'Node attach requires an enabled local inspector: start the target with --inspect, then use --attach --port <port>.'
    );
  }
  if (port !== undefined && !isNode) {
    throw new ControlError(
      'UNSUPPORTED_ATTACH',
      '--port is currently supported only for the Node adapter.'
    );
  }
  const target = program ? resolve(cwd, program) : undefined;
  if (target && !(await stat(target)).isFile())
    throw new ControlError('INVALID_ARGUMENT', 'Program is not a file.');
  const env: Record<string, string> = {};
  for (const assignment of options.env) {
    const index = assignment.indexOf('=');
    if (index <= 0)
      throw new ControlError('INVALID_ARGUMENT', 'Environment values must use NAME=value.');
    env[assignment.slice(0, index)] = assignment.slice(index + 1);
  }
  return {
    sessionId: randomUUID(),
    adapter: options.adapter,
    program: target,
    cwd,
    args: options.args,
    breakpoints: options.breakpoint,
    exceptionFilters: options.breakOnException,
    env,
    timeout: lifetime(options.timeout),
    attach: options.attach === true,
    pid,
    port,
    stopAtEntry:
      !options.attach &&
      (options.stopAtEntry === true ||
        (options.breakpoint.length === 0 && options.breakOnException.length === 0)),
    sourceMapOverrides: options.sourceMapOverrides,
  };
}

async function startWorker(options: StartOptions): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [...process.execArgv, process.argv[1], '__session-worker'],
      {
        cwd: options.cwd,
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      }
    );
    let settled = false;
    const finish = (error?: Error, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) child.kill('SIGTERM');
      if (child.connected) child.disconnect();
      child.unref();
      if (error) reject(error);
      else resolvePromise(result);
    };
    const timeout = setTimeout(
      () => finish(new ControlError('STARTUP_TIMEOUT', 'Session worker did not start within 35s.')),
      35000
    );
    child.on('error', (error) => finish(error));
    child.once('exit', () =>
      finish(new ControlError('STARTUP_FAILED', 'Session worker exited before startup completed.'))
    );
    child.once('message', (message) => finish(undefined, message));
    child.send(options, (error) => {
      if (error) finish(error);
    });
  });
}

function print(value: unknown): void {
  console.log(JSON.stringify({ schemaVersion: 1, ...(value as object) }));
}

async function action(id: string, command: () => LiveCommand): Promise<void> {
  try {
    print({ sessionId: id, ok: true, result: await sendCommand(id, command()) });
  } catch (error) {
    print({ sessionId: id, ...errorResult(error) });
    process.exitCode = 1;
  }
}

export function registerLiveCommands(program: Command): void {
  program
    .command('start [program]')
    .description('Start a private, bounded debug session controlled by later commands')
    .requiredOption('-a, --adapter <name>', 'Debug adapter')
    .option('--cwd <path>', 'Working directory and base for relative paths')
    .option('--args <args...>', 'Program arguments', [])
    .option('-b, --breakpoint <spec...>', 'Initial file:line breakpoints', [])
    .option('--break-on-exception <filter...>', 'Exception filters', [])
    .option('--env <values...>', 'Target environment NAME=value assignments', [])
    .option('--attach', 'Attach to an existing process')
    .option('--pid <id>', 'Process ID for attach (non-Node adapters)')
    .option('--port <port>', 'Local Node inspector port for attach')
    .option('--stop-at-entry', 'Pause at entry even when breakpoints were specified')
    .option('--source-map-overrides <jsonOrPreset>', 'Source-map path overrides')
    .option(
      '-t, --timeout <duration>',
      'Total session lifetime, including paused time (1s–60m)',
      `${DEFAULT_LIFETIME_MS / 60000}m`
    )
    .action(async (target: string | undefined, options: CliStartOptions) => {
      try {
        const result = (await startWorker(await normalizeStart(target, options))) as {
          ok: boolean;
        };
        print(result);
        if (!result.ok) process.exitCode = 1;
      } catch (error) {
        print(errorResult(error));
        process.exitCode = 1;
      }
    });

  program
    .command('status <session-id>')
    .description('Read state, current stop, capabilities, and recent events')
    .action(async (id: string) => action(id, () => ({ action: 'status' })));
  program
    .command('inspect <session-id>')
    .description('Inspect locals or evaluate an expression at the current stop')
    .option('-e, --expr <expression>', 'Expression to evaluate (may execute code in the target)')
    .option('--frame <id>', 'Frame ID from status; requires --stop')
    .option('--stop <id>', 'Require this stop generation; reject stale requests')
    .option('--depth <count>', 'Maximum object expansion depth (0–4)', '2')
    .action(
      async (
        id: string,
        options: { expr?: string; frame?: string; stop?: string; depth?: string }
      ) =>
        action(id, () => ({
          action: 'inspect',
          expression: options.expr,
          frameId: numberOption(options.frame, '--frame'),
          stopId: numberOption(options.stop, '--stop'),
          depth: numberOption(options.depth, '--depth'),
        }))
    );
  program
    .command('step <session-id>')
    .description('Step once and leave the next stop paused')
    .addOption(new Option('--into', 'Step into').conflicts('out'))
    .addOption(new Option('--out', 'Step out').conflicts('into'))
    .option('--stop <id>', 'Require this stop generation')
    .action(async (id: string, options: { into?: boolean; out?: boolean; stop?: string }) =>
      action(id, () => ({
        action: 'step',
        kind: options.into ? 'into' : options.out ? 'out' : 'over',
        stopId: numberOption(options.stop, '--stop'),
      }))
    );
  program
    .command('continue <session-id>')
    .description('Resume until the next stop or exit')
    .option('--stop <id>', 'Require this stop generation')
    .action(async (id: string, options: { stop?: string }) =>
      action(id, () => ({ action: 'continue', stopId: numberOption(options.stop, '--stop') }))
    );
  program
    .command('pause <session-id>')
    .description('Request a pause of a running target')
    .option('--thread <id>', 'Thread to pause (defaults to the first thread)')
    .action(async (id: string, options: { thread?: string }) =>
      action(id, () => ({ action: 'pause', threadId: numberOption(options.thread, '--thread') }))
    );
  program
    .command('stop <session-id>')
    .description('Close a session; attached targets are left running')
    .action(async (id: string) => action(id, () => ({ action: 'stop' })));

  program.command('__session-worker', { hidden: true }).action(async () => {
    if (!process.send) {
      process.exitCode = 1;
      return;
    }
    const options = await new Promise<StartOptions>((resolveOptions, reject) => {
      const timer = setTimeout(() => reject(new Error('Missing worker configuration')), 5000);
      process.once('message', (message) => {
        clearTimeout(timer);
        resolveOptions(message as StartOptions);
      });
    });
    await runWorker(options);
  });
}
