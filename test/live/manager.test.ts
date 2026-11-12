import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DebugSession } from '../../src/session/manager.js';
import { SessionController } from '../../src/live/controller.js';
import { OutputFormatter } from '../../src/output/formatter.js';
import type { AdapterConfig } from '../../src/adapters/base.js';

const mocks = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock('../../src/dap/client.js', () => ({
  DapClient: class {
    constructor() {
      return mocks.client;
    }
  },
}));
vi.mock('../../src/dap/socket-client.js', () => ({
  SocketDapClient: class {
    constructor() {
      return mocks.client;
    }
  },
}));

function setup(requiresLaunchFirst = false) {
  const client = Object.assign(new EventEmitter(), {
    connect: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue({}),
    getCapabilities: vi.fn(() => ({})),
    isConnected: vi.fn(() => true),
    disconnect: vi.fn().mockResolvedValue(undefined),
    setBreakpoints: vi.fn().mockResolvedValue({ breakpoints: [] }),
    setExceptionBreakpoints: vi.fn().mockResolvedValue(undefined),
    stackTrace: vi
      .fn()
      .mockResolvedValue({ stackFrames: [{ id: 1, name: 'main', line: 3, column: 1 }] }),
    scopes: vi.fn().mockResolvedValue({ scopes: [] }),
    continue: vi.fn().mockResolvedValue({}),
    launch: vi.fn().mockResolvedValue(undefined),
    attach: vi.fn(),
    configurationDone: vi.fn(),
  });
  let configured = false;
  let attached: (() => void) | undefined;
  client.attach.mockImplementation(() => {
    if (requiresLaunchFirst) queueMicrotask(() => client.emit('initialized'));
    return configured
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          attached = resolve;
        });
  });
  client.configurationDone.mockImplementation(async () => {
    configured = true;
    attached?.();
  });
  mocks.client = client;
  const control = new SessionController();
  const formatter = new OutputFormatter({
    stream: new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    }),
  });
  const adapter: AdapterConfig = {
    id: 'test',
    name: 'test',
    command: 'test',
    detect: async () => 'test',
    installHint: '',
    launchConfig: (options) => ({ program: options.program, stopOnEntry: options.stopAtEntry }),
    attachConfig: (options) => ({ processId: options.pid }),
    ...(requiresLaunchFirst
      ? { requiresLaunchFirst: true }
      : { transport: 'socket', socketPort: 0 }),
  };
  return { client, control, formatter, adapter };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('live sessions use shared DAP lifecycle', () => {
  it.each([false, true])(
    'configures attach without deadlocking (requires launch first: %s)',
    async (requiresLaunchFirst) => {
      const { client, control, formatter, adapter } = setup(requiresLaunchFirst);
      const session = new DebugSession(
        { adapter, control, attach: true, pid: 123, breakpoints: [], timeout: 1000 },
        formatter
      );
      const run = session.run();
      await vi.waitFor(() => expect(control.snapshot().state).toBe('running'));
      await control.execute({ action: 'stop' });
      await run;
      expect(client.attach).toHaveBeenCalledWith({ processId: 123 });
      expect(client.disconnect).toHaveBeenCalledWith(false);
      const configured = client.configurationDone.mock.invocationCallOrder[0];
      const attaching = client.attach.mock.invocationCallOrder[0];
      expect(requiresLaunchFirst ? attaching < configured : configured < attaching).toBe(true);
    }
  );

  it('passes stop-at-entry and terminates a launched target during explicit cleanup', async () => {
    const { client, control, formatter, adapter } = setup();
    const session = new DebugSession(
      { adapter, control, program: '/tmp/app', breakpoints: [], stopAtEntry: true, timeout: 1000 },
      formatter
    );
    const run = session.run();
    await vi.waitFor(() => expect(control.snapshot().state).toBe('running'));
    expect(client.launch).toHaveBeenCalledWith({ program: '/tmp/app', stopOnEntry: true });
    client.emit('stopped', { reason: 'breakpoint', threadId: 1 });
    await vi.waitFor(() => expect(control.snapshot().stop?.ready).toBe(true));
    expect(client.continue).not.toHaveBeenCalled();
    await control.execute({ action: 'stop' });
    await run;
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('preserves automatic continuation for batch sessions', async () => {
    const { client, formatter, adapter } = setup();
    const session = new DebugSession(
      { adapter, program: '/tmp/app', breakpoints: [], captureLocals: false, timeout: 1000 },
      formatter
    );
    const run = session.run();
    await vi.waitFor(() => expect(client.launch).toHaveBeenCalled());
    client.emit('stopped', { reason: 'breakpoint', threadId: 1 });
    await vi.waitFor(() => expect(client.continue).toHaveBeenCalledWith({ threadId: 1 }));
    client.emit('terminated');
    await run;
  });

  it('cleans up an early attach rejection without waiting for initialized', async () => {
    const { client, control, formatter, adapter } = setup(true);
    client.attach.mockRejectedValue(new Error('Attach refused'));
    const session = new DebugSession(
      { adapter, control, attach: true, pid: 123, breakpoints: [], timeout: 1000 },
      formatter
    );
    await expect(session.run()).rejects.toThrow('Attach refused');
    expect(client.configurationDone).not.toHaveBeenCalled();
    expect(client.listenerCount('initialized')).toBe(0);
    expect(client.disconnect).toHaveBeenCalledWith(false);
  });

  it('records startup failures and still disconnects', async () => {
    const { client, control, formatter, adapter } = setup();
    client.initialize.mockRejectedValue(new Error('Bad handshake'));
    const session = new DebugSession(
      { adapter, control, program: '/tmp/app', breakpoints: [], timeout: 1000 },
      formatter
    );
    await expect(session.run()).rejects.toThrow('Bad handshake');
    expect(control.snapshot()).toMatchObject({ state: 'failed', outcome: 'startup_error' });
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.launch).not.toHaveBeenCalled();
  });
});
