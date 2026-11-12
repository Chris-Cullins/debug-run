import { describe, expect, it, vi } from 'vitest';
import { BreakpointManager } from '../../src/session/breakpoints.js';
import type { IDapClient } from '../../src/dap/client-interface.js';
import type { OutputFormatter } from '../../src/output/formatter.js';
function setup() {
  const client = {
    setBreakpoints: vi
      .fn()
      .mockResolvedValue({
        breakpoints: [{ id: 0, verified: true, line: 11, source: { path: '/resolved.js' } }],
      }),
  };
  const formatter = { breakpointSet: vi.fn() };
  const manager = new BreakpointManager(
    client as unknown as IDapClient,
    formatter as unknown as OutputFormatter,
    { cwd: '/project', adapterType: 'node' }
  );
  manager.addBreakpoint('app.js:10');
  return { manager, client, formatter };
}
describe('breakpoint evidence', () => {
  it('preserves requested and relocated locations separately', async () => {
    const { manager, formatter } = setup();
    await manager.setAllBreakpoints();
    expect(manager.getReport()[0]).toMatchObject({
      requested: { line: 10 },
      resolved: { file: '/resolved.js', line: 11 },
      binding: 'verified',
      hitStatus: 'not_observed',
    });
    expect(formatter.breakpointSet.mock.calls[0][6]).toMatchObject({
      requestedLine: 10,
      resolvedLine: 11,
      suggestions: [],
    });
  });
  it('tracks hits including adapter ID zero, without counting unknown or duplicated IDs', async () => {
    const { manager } = setup();
    await manager.setAllBreakpoints();
    manager.recordHits([0, 0, 999]);
    manager.recordHits();
    expect(manager.getReport()[0]).toMatchObject({
      code: 'BREAKPOINT_REACHED',
      hits: 1,
      hitStatus: 'observed',
    });
    expect(manager.getHitCount()).toBe(1);
  });
  it('updates async binding changes without losing the original request or hit history', async () => {
    const { manager } = setup();
    await manager.setAllBreakpoints();
    manager.recordHits([0]);
    manager.updateBinding({
      reason: 'changed',
      breakpoint: { id: 0, verified: false, message: 'Module unloaded' },
    });
    expect(manager.getReport()[0]).toMatchObject({
      requested: { line: 10 },
      binding: 'unverified',
      hits: 1,
      adapterMessage: 'Module unloaded',
    });
  });
  it('distinguishes rejected requests from unverified bindings', async () => {
    const { manager, client } = setup();
    client.setBreakpoints.mockRejectedValue(new Error('Unsupported condition'));
    await manager.setAllBreakpoints();
    expect(manager.getReport()[0]).toMatchObject({
      code: 'BREAKPOINT_REJECTED',
      binding: 'rejected',
      adapterMessage: 'Unsupported condition',
    });
    manager.applyBindings('/project/app.js', [{ verified: false, message: 'Waiting for script' }]);
    expect(manager.getReport()[0]).toMatchObject({
      code: 'BREAKPOINT_UNVERIFIED',
      binding: 'unverified',
    });
  });
  it('retains requests omitted by the adapter and never treats synthetic IDs as hit evidence', async () => {
    const { manager, client } = setup();
    client.setBreakpoints.mockResolvedValue({ breakpoints: [] });
    await manager.setAllBreakpoints();
    manager.recordHits([manager.getReport()[0].id!]);
    expect(manager.getReport()[0]).toMatchObject({
      binding: 'unverified',
      hits: 0,
      adapterMessage: 'Adapter returned no binding for this request.',
    });
  });
  it('reassociates child-session bindings by request index, including shared lines', async () => {
    const { manager } = setup();
    manager.addBreakpoint('app.js:10?x > 1');
    await manager.setAllBreakpoints();
    manager.applyBindings('/project/app.js', [
      { id: 20, verified: true, line: 10 },
      { id: 21, verified: true, line: 10 },
    ]);
    manager.recordHits([21]);
    expect(manager.getReport().map((bp) => bp.hits)).toEqual([0, 1]);
  });
});
