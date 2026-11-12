import { Writable } from 'node:stream';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { getAdapter, getAdapterNames } from '../adapters/index.js';
import { DebugSession } from '../session/manager.js';
import { OutputFormatter } from '../output/formatter.js';
import { validateAllBreakpoints } from '../session/breakpoints.js';
import { parseSourceMapOverrides } from '../sourcemaps/overrides.js';
import { ControlError, SessionController } from './controller.js';
import { createSessionDirectory, writeSessionFile } from './storage.js';
import { errorResult } from './protocol.js';
import { startControlServer } from './server.js';

export interface StartOptions {
  sessionId: string;
  adapter: string;
  program?: string;
  cwd: string;
  args: string[];
  breakpoints: string[];
  exceptionFilters: string[];
  env: Record<string, string>;
  timeout: number;
  attach: boolean;
  pid?: number;
  port?: number;
  stopAtEntry: boolean;
  sourceMapOverrides?: string;
}

/** Bounded recent events are kept in memory, not persisted as a recording. */
class EventBuffer extends Writable {
  events: unknown[] = [];
  droppedEvents = 0;
  private bytes = 0;
  private sizes: number[] = [];
  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    const size = chunk.byteLength;
    if (size > 64 * 1024) {
      this.droppedEvents++;
      callback();
      return;
    }
    try {
      this.events.push(JSON.parse(chunk.toString()));
      this.sizes.push(size);
      this.bytes += size;
      while (this.events.length > 100 || this.bytes > 256 * 1024) {
        this.events.shift();
        this.bytes -= this.sizes.shift()!;
        this.droppedEvents++;
      }
    } catch {
      this.droppedEvents++;
    }
    callback();
  }
}

export async function runWorker(options: StartOptions): Promise<void> {
  const controller = new SessionController();
  let endpoint: Awaited<ReturnType<typeof startControlServer>> | undefined;
  let directory: string | undefined;
  let announced = false;
  let running: Promise<void> | undefined;
  let forcedExit: ReturnType<typeof setTimeout> | undefined;
  const shutdown = () => {
    controller.abort('stopped');
    forcedExit ??= setTimeout(() => process.exit(1), 12000);
    forcedExit.unref();
  };
  const disconnected = () => {
    if (!announced) shutdown();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('disconnect', disconnected);
  try {
    directory = await createSessionDirectory(options.sessionId);
    const adapter = getAdapter(options.adapter);
    if (!adapter)
      throw new ControlError(
        'UNKNOWN_ADAPTER',
        `Available adapters: ${getAdapterNames().join(', ')}`
      );
    const errors = validateAllBreakpoints(options.breakpoints, []);
    if (errors.length) throw new ControlError('INVALID_BREAKPOINT', errors.join('; '));
    if (!(await adapter.detect())) throw new ControlError('ADAPTER_NOT_FOUND', adapter.installHint);
    if (controller.snapshot().state === 'ended') {
      throw new ControlError('STARTUP_CANCELLED', 'Startup was cancelled.');
    }
    if (
      adapter.exceptionFilters &&
      options.exceptionFilters.some((filter) => !adapter.exceptionFilters!.includes(filter))
    ) {
      throw new ControlError(
        'INVALID_EXCEPTION_FILTER',
        `Supported filters: ${adapter.exceptionFilters.join(', ')}`
      );
    }
    // Ask js-debug to choose its port; the socket client reads the announced port.
    const liveAdapter =
      adapter.transport === 'socket'
        ? { ...adapter, socketPort: 0, args: [adapter.args![0], '0', '127.0.0.1'] }
        : adapter;
    const events = new EventBuffer();
    const session = new DebugSession(
      {
        adapter: liveAdapter,
        control: controller,
        program: options.program,
        cwd: options.cwd,
        args: options.args,
        env: options.env,
        breakpoints: options.breakpoints,
        exceptionFilters: options.exceptionFilters,
        timeout: options.timeout,
        attach: options.attach,
        pid: options.pid,
        attachPort: options.port,
        stopAtEntry: options.stopAtEntry,
        sourceMapOverrides: options.sourceMapOverrides
          ? parseSourceMapOverrides(options.sourceMapOverrides, options.cwd)
          : undefined,
      },
      new OutputFormatter({ stream: events })
    );
    endpoint = await startControlServer(
      controller,
      () => {
        controller.abort('adapter_error', 'A session command exceeded its time budget.');
      },
      () => ({ events: [...events.events], droppedEvents: events.droppedEvents })
    );
    await writeSessionFile(directory, 'connection.json', {
      sessionId: options.sessionId,
      port: endpoint.port,
      token: endpoint.token,
    });
    running = session.run().catch((error: unknown) => {
      controller.finish('startup_error', error instanceof Error ? error.message : String(error));
    });
    const deadline = Date.now() + 30000;
    while (controller.snapshot().state === 'starting' && Date.now() < deadline) await delay(25);
    if (controller.snapshot().state === 'starting')
      controller.abort('startup_error', 'Adapter startup timed out.');
    const status = controller.snapshot();
    if (status.state === 'failed') {
      process.send?.({
        ...errorResult(new ControlError('STARTUP_FAILED', status.error ?? 'Startup failed')),
        sessionId: options.sessionId,
      });
    } else {
      process.send?.({ ok: true, sessionId: options.sessionId, result: status });
    }
    announced = true;
    if (process.connected) process.disconnect();
    await running;
  } catch (error) {
    controller.abort('startup_error', error instanceof Error ? error.message : String(error));
    if (process.connected) process.send?.({ ...errorResult(error), sessionId: options.sessionId });
  } finally {
    await running;
    try {
      if (directory) {
        await writeSessionFile(directory, 'result.json', controller.snapshot());
        await rm(join(directory, 'connection.json'), { force: true });
      }
    } finally {
      if (endpoint) {
        endpoint.server.closeIdleConnections();
        await new Promise<void>((resolve) => endpoint!.server.close(() => resolve()));
      }
    }
    clearTimeout(forcedExit);
    process.removeListener('SIGTERM', shutdown);
    process.removeListener('SIGINT', shutdown);
    process.removeListener('disconnect', disconnected);
    if (process.connected) process.disconnect();
  }
}
