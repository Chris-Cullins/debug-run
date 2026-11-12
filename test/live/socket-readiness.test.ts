import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { SocketDapClient } from '../../src/dap/socket-client.js';

const state = vi.hoisted(() => ({ transports: [] as any[] }));
vi.mock('node:child_process', () => ({
  spawn: () =>
    Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    }),
}));
vi.mock('../../src/dap/socket-transport.js', () => ({
  SocketDapTransport: class extends EventEmitter {
    connect = vi.fn().mockResolvedValue(undefined);
    isOpen = () => true;
    close = vi.fn();
    sendResponse = vi.fn();
    sendRequest = vi.fn().mockResolvedValue({});
    constructor() {
      super();
      state.transports.push(this);
    }
  },
}));

describe('live socket target readiness', () => {
  it.each(['attach', 'launch'] as const)(
    'waits for the child target after root %s responds',
    async (action) => {
      state.transports = [];
      const client = new SocketDapClient({
        command: 'mock',
        port: 1234,
        connectDelay: 0,
        waitForTarget: true,
      });
      await client.connect();
      await client.initialize();
      let ready = false;
      const starting = client[action]({}).then(() => {
        ready = true;
      });
      await Promise.resolve();
      expect(ready).toBe(false);
      const root = state.transports[0];
      root.emit('reverseRequest:startDebugging', { seq: 1, arguments: { configuration: {} } });
      const child = state.transports[1];
      let release!: () => void;
      child.sendRequest.mockImplementation((command: string) =>
        command === 'launch'
          ? new Promise<void>((resolve) => {
              release = resolve;
            })
          : Promise.resolve({})
      );
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      expect(ready).toBe(false);
      release();
      await starting;
      expect(ready).toBe(true);
      expect(client.listenerCount('targetReady')).toBe(0);
      await client.disconnect();
    }
  );
});
