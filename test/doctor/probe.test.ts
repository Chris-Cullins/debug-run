import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probeAdapter } from '../../src/doctor/probe.js';
import type { AdapterConfig } from '../../src/adapters/base.js';
const mocks = vi.hoisted(() => ({ client: undefined as any }));
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
const adapter = { name: 'test', id: 'test', command: 'test' } as AdapterConfig;
beforeEach(() => {
  mocks.client = Object.assign(new EventEmitter(), {
    connect: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue({ supportsConditionalBreakpoints: true }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    launch: vi.fn(),
    attach: vi.fn(),
  });
});
afterEach(() => vi.useRealTimers());
describe('bounded adapter handshake', () => {
  it('initializes and disconnects without launching or attaching', async () => {
    expect(await probeAdapter(adapter, '/tmp')).toEqual({ supportsConditionalBreakpoints: true });
    expect(mocks.client.disconnect).toHaveBeenCalledWith(false);
    expect(mocks.client.launch).not.toHaveBeenCalled();
    expect(mocks.client.attach).not.toHaveBeenCalled();
  });
  it('cleans up after initialization rejects', async () => {
    mocks.client.initialize.mockRejectedValue(new Error('No handshake'));
    await expect(probeAdapter(adapter, '/tmp')).rejects.toThrow('No handshake');
    expect(mocks.client.disconnect).toHaveBeenCalledWith(false);
  });
  it('times out and cannot initialize after a delayed connection', async () => {
    vi.useFakeTimers();
    let connected!: () => void;
    mocks.client.connect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          connected = resolve;
        })
    );
    const result = probeAdapter(adapter, '/tmp');
    const assertion = expect(result).rejects.toThrow('exceeded 10 seconds');
    await vi.advanceTimersByTimeAsync(10000);
    await assertion;
    connected();
    await Promise.resolve();
    expect(mocks.client.initialize).not.toHaveBeenCalled();
    expect(mocks.client.disconnect).toHaveBeenCalledWith(false);
  });
});
