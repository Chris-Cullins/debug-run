import { describe, expect, it, vi } from 'vitest';
import { SessionController } from '../../src/live/controller.js';
import type { IDapClient } from '../../src/dap/client-interface.js';

function setup() {
  const client = {
    getCapabilities: vi.fn(() => ({ supportsConditionalBreakpoints: true })),
    stackTrace: vi
      .fn()
      .mockResolvedValue({ stackFrames: [{ id: 10, name: 'main', line: 3, column: 1 }] }),
    evaluate: vi.fn().mockResolvedValue({ result: '3', type: 'number', variablesReference: 0 }),
    scopes: vi.fn().mockResolvedValue({ scopes: [] }),
    variables: vi.fn().mockResolvedValue({ variables: [] }),
    threads: vi.fn().mockResolvedValue({ threads: [{ id: 7, name: 'main' }] }),
    pause: vi.fn().mockResolvedValue({}),
    continue: vi.fn().mockResolvedValue({}),
    next: vi.fn().mockResolvedValue({}),
    stepIn: vi.fn().mockResolvedValue({}),
    stepOut: vi.fn().mockResolvedValue({}),
  };
  const controller = new SessionController();
  const end = vi.fn();
  controller.bind(client as unknown as IDapClient, end);
  controller.started();
  const paused = () =>
    controller.stopped({ reason: 'breakpoint', threadId: 7, allThreadsStopped: true });
  return { controller, client, end, paused };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('live session controller', () => {
  it('retains a breakpoint stop without automatically continuing', async () => {
    const { controller, client, paused } = setup();
    await paused();
    expect(controller.snapshot()).toMatchObject({
      state: 'paused',
      stop: { id: 1, threadId: 7, ready: true },
    });
    expect(client.continue).not.toHaveBeenCalled();
    controller.started();
    expect(controller.snapshot().state).toBe('paused');
  });

  it('keeps exception stops paused', async () => {
    const { controller, client } = setup();
    await controller.stopped({ reason: 'exception', threadId: 7 });
    expect(controller.snapshot().stop?.reason).toBe('exception');
    expect(client.continue).not.toHaveBeenCalled();
  });

  it('evaluates in the selected current frame', async () => {
    const { controller, client, paused } = setup();
    await paused();
    const value = await controller.execute({
      action: 'inspect',
      expression: 'total',
      frameId: 10,
      stopId: 1,
    });
    expect(client.evaluate).toHaveBeenCalledWith({
      expression: 'total',
      frameId: 10,
      context: 'watch',
    });
    expect(value).toMatchObject({ stopId: 1, frameId: 10, value: { value: 3 } });
  });

  it('bounds expansion when an adapter ignores variable paging', async () => {
    const { controller, client, paused } = setup();
    client.evaluate.mockResolvedValue({ result: '{}', type: 'object', variablesReference: 1 });
    client.variables.mockResolvedValue({
      variables: Array.from({ length: 100 }, (_, i) => ({
        name: `field${i}`,
        value: String(i),
        type: 'number',
        variablesReference: 0,
      })),
    });
    await paused();
    const result = (await controller.execute({ action: 'inspect', expression: 'obj' })) as {
      value: { value: object };
      truncated: boolean;
    };
    expect(Object.keys(result.value.value)).toHaveLength(20);
    expect(result.truncated).toBe(true);
  });

  it('bounds the total number of object expansions', async () => {
    const { controller, client, paused } = setup();
    client.evaluate.mockResolvedValue({ result: '{}', type: 'object', variablesReference: 1 });
    let reference = 1;
    client.variables.mockImplementation(async () => ({
      variables: Array.from({ length: 20 }, (_, i) => ({
        name: `field${i}`,
        value: '{}',
        type: 'object',
        variablesReference: ++reference,
      })),
    }));
    await paused();
    const result = await controller.execute({ action: 'inspect', expression: 'obj', depth: 4 });
    expect(result).toMatchObject({ truncated: true, limits: { maxVariables: 200 } });
    expect(client.variables.mock.calls.length).toBeLessThanOrEqual(200);
  });

  it('requires a stop guard for explicit frame selection', async () => {
    const { controller, paused } = setup();
    await paused();
    await expect(controller.execute({ action: 'inspect', frameId: 10 })).rejects.toMatchObject({
      code: 'STOP_REQUIRED',
    });
    await expect(
      controller.execute({ action: 'inspect', frameId: 11, stopId: 1 })
    ).rejects.toMatchObject({ code: 'INVALID_FRAME' });
  });

  it('invalidates the old stop before resume and rejects it at the next stop', async () => {
    const { controller, paused } = setup();
    await paused();
    await controller.execute({ action: 'continue', stopId: 1 });
    expect(controller.snapshot()).toEqual({ state: 'running' });
    await expect(controller.execute({ action: 'inspect', stopId: 1 })).rejects.toMatchObject({
      code: 'STALE_STOP',
    });
    await paused();
    await expect(controller.execute({ action: 'step', stopId: 1 })).rejects.toMatchObject({
      code: 'STALE_STOP',
    });
    expect(controller.snapshot().stop?.id).toBe(2);
  });

  it.each([
    ['over', 'next'],
    ['into', 'stepIn'],
    ['out', 'stepOut'],
  ] as const)('supports step %s', async (kind, method) => {
    const { controller, client, paused } = setup();
    await paused();
    await controller.execute({ action: 'step', kind, stopId: 1 });
    expect(client[method]).toHaveBeenCalledWith({ threadId: 7 });
    expect(controller.snapshot().state).toBe('running');
  });

  it('does not overwrite a new stop arriving before the step response', async () => {
    const { controller, client, paused } = setup();
    await paused();
    let capture!: Promise<void>;
    client.next.mockImplementation(async () => {
      capture = controller.stopped({ reason: 'step', threadId: 7 });
    });
    await controller.execute({ action: 'step' });
    await capture;
    expect(controller.snapshot()).toMatchObject({ state: 'paused', stop: { id: 2, ready: true } });
  });

  it('rejects inspection if execution resumes while evaluation is in flight', async () => {
    const { controller, client, paused } = setup();
    await paused();
    const evaluation = deferred<{ result: string; variablesReference: number }>();
    client.evaluate.mockReturnValue(evaluation.promise);
    const inspect = controller.execute({ action: 'inspect', expression: 'total', stopId: 1 });
    await vi.waitFor(() => expect(client.evaluate).toHaveBeenCalled());
    controller.continued();
    evaluation.resolve({ result: '3', variablesReference: 0 });
    await expect(inspect).rejects.toMatchObject({ code: 'STALE_STOP' });
  });

  it('rejects a snapshot from a stop superseded during evaluation', async () => {
    const { controller, client, paused } = setup();
    await paused();
    const evaluation = deferred<{ result: string; variablesReference: number }>();
    client.evaluate.mockReturnValue(evaluation.promise);
    const inspect = controller.execute({ action: 'inspect', expression: 'total', stopId: 1 });
    await vi.waitFor(() => expect(client.evaluate).toHaveBeenCalled());
    const capture = controller.stopped({ reason: 'breakpoint', threadId: 9 });
    evaluation.resolve({ result: '3', variablesReference: 0 });
    await expect(inspect).rejects.toMatchObject({ code: 'STALE_STOP' });
    await capture;
    expect(controller.snapshot().stop?.threadId).toBe(9);
  });

  it('serializes competing resume commands so only one runs', async () => {
    const { controller, client, paused } = setup();
    await paused();
    const results = await Promise.allSettled([
      controller.execute({ action: 'continue', stopId: 1 }),
      controller.execute({ action: 'step', stopId: 1 }),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(client.continue).toHaveBeenCalledTimes(1);
    expect(client.next).not.toHaveBeenCalled();
  });

  it('keeps the target paused if stack inspection fails', async () => {
    const { controller, client, paused } = setup();
    client.stackTrace.mockRejectedValue(new Error('No symbols'));
    await paused();
    expect(controller.snapshot()).toMatchObject({ state: 'paused', stop: { error: 'No symbols' } });
    await expect(controller.execute({ action: 'inspect' })).rejects.toMatchObject({
      code: 'INVALID_FRAME',
    });
    await controller.execute({ action: 'continue' });
    expect(client.continue).toHaveBeenCalledOnce();
  });

  it('pauses an actual enumerated thread', async () => {
    const { controller, client } = setup();
    await expect(controller.execute({ action: 'pause', threadId: 12 })).rejects.toMatchObject({
      code: 'INVALID_THREAD',
    });
    await controller.execute({ action: 'pause' });
    expect(client.pause).toHaveBeenCalledWith(7);
  });

  it('does not replace terminal outcome with cleanup events', async () => {
    const { controller, end, paused } = setup();
    await paused();
    await controller.execute({ action: 'stop' });
    controller.finish('adapter_error', 'Disconnected');
    controller.continued();
    await paused();
    expect(controller.snapshot()).toEqual({ state: 'ended', outcome: 'stopped' });
    await controller.execute({ action: 'stop' });
    expect(end).toHaveBeenCalledOnce();
  });

  it('retains timeout and exit code outcomes', () => {
    const a = setup().controller;
    a.finish('timeout', 'Budget exceeded');
    a.finish('startup_error', 'Later error');
    expect(a.snapshot()).toMatchObject({
      state: 'failed',
      outcome: 'timeout',
      error: 'Budget exceeded',
    });
    const b = setup().controller;
    b.finish('exited', undefined, 3);
    expect(b.snapshot()).toEqual({ state: 'ended', outcome: 'exited', exitCode: 3 });
  });
});
