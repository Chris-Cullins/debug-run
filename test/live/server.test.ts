import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SessionController } from '../../src/live/controller.js';

const mocks = vi.hoisted(() => ({ handler: undefined as unknown }));
vi.mock('node:http', () => ({
  createServer: vi.fn((handler) => {
    mocks.handler = handler;
    return {
      once: vi.fn(),
      removeListener: vi.fn(),
      listen: vi.fn((_port, _host, done) => done()),
      address: vi.fn(() => ({ port: 12345 })),
    };
  }),
}));
import { startControlServer } from '../../src/live/server.js';

async function request(token: string, body: string, overrides: Record<string, unknown> = {}) {
  const req = {
    method: 'POST',
    url: '/',
    headers: { authorization: `Bearer ${token}` },
    setTimeout: vi.fn(),
    destroy: vi.fn(),
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(body);
    },
    ...overrides,
  };
  let code = 0;
  let response = '';
  const res = {
    setHeader: vi.fn(),
    destroyed: false,
    writeHead: vi.fn((status: number) => {
      code = status;
    }),
    end: vi.fn((value: string) => {
      response = value;
    }),
  };
  await (mocks.handler as (request: IncomingMessage, response: ServerResponse) => Promise<void>)(
    req as unknown as IncomingMessage,
    res as unknown as ServerResponse
  );
  return { code, body: JSON.parse(response) };
}

describe('local control endpoint', () => {
  const execute = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockResolvedValue({ state: 'paused' });
  });

  it('rejects missing/wrong authentication and browser origins without dispatching', async () => {
    const { token } = await startControlServer(
      { execute } as unknown as SessionController,
      vi.fn()
    );
    expect((await request('wrong', '{"action":"stop"}')).code).toBe(401);
    expect(
      (
        await request(token, '{"action":"stop"}', {
          headers: { authorization: `Bearer ${token}`, origin: 'https://example.com' },
        })
      ).code
    ).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it('validates JSON, command shape, and request size before dispatch', async () => {
    const { token } = await startControlServer(
      { execute } as unknown as SessionController,
      vi.fn()
    );
    expect((await request(token, '{')).body.error.code).toBe('INVALID_COMMAND');
    expect((await request(token, '{"action":"unknown"}')).body.error.code).toBe('INVALID_COMMAND');
    expect((await request(token, 'x'.repeat(17000))).body.error.code).toBe('REQUEST_TOO_LARGE');
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns a bounded error instead of oversized debugger data', async () => {
    execute.mockResolvedValue({ value: 'x'.repeat(1024 * 1024) });
    const { token } = await startControlServer(
      { execute } as unknown as SessionController,
      vi.fn()
    );
    const result = await request(token, '{"action":"inspect"}');
    expect(result.code).toBe(413);
    expect(result.body.error.code).toBe('RESPONSE_TOO_LARGE');
  });

  it('closes a session on command timeout without leaving the request unresolved', async () => {
    vi.useFakeTimers();
    try {
      execute.mockReturnValue(new Promise(() => {}));
      const terminate = vi.fn();
      const { token } = await startControlServer(
        { execute } as unknown as SessionController,
        terminate
      );
      const result = request(token, '{"action":"inspect"}');
      await vi.advanceTimersByTimeAsync(15000);
      expect((await result).body.error.code).toBe('REQUEST_TIMEOUT');
      expect(terminate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
