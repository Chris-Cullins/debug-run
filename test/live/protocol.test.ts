import { describe, expect, it } from 'vitest';
import { parseCommand } from '../../src/live/protocol.js';
import { lifetime } from '../../src/live/cli.js';
import { sessionDirectory } from '../../src/live/storage.js';

describe('live command validation', () => {
  it.each([
    null,
    [],
    { action: 'delete' },
    { action: 'status', token: 'x' },
    { action: 'inspect', depth: 5 },
    { action: 'inspect', depth: -1 },
    { action: 'step', kind: 'back' },
    { action: 'inspect', frameId: '10' },
    { action: 'inspect', frameId: 1.5 },
    { action: 'inspect', stopId: -1 },
    { action: 'inspect', expression: '' },
    { action: 'inspect', expression: 'x'.repeat(8193) },
  ])('rejects malformed commands: %j', (value) => {
    expect(() => parseCommand(value)).toThrow();
  });

  it('accepts zero frame IDs and bounded inspection', () => {
    expect(parseCommand({ action: 'inspect', frameId: 0, stopId: 1, depth: 0 })).toMatchObject({
      frameId: 0,
      depth: 0,
    });
  });

  it.each(['0', '0s', '999ms', '61m', 'Infinity', '1.5m', '-1s', '9007199254740993m'])(
    'rejects invalid lifetime %s',
    (value) => {
      expect(() => lifetime(value)).toThrow();
    }
  );
  it('accepts finite lifetime boundaries', () => {
    expect(lifetime('1s')).toBe(1000);
    expect(lifetime('60m')).toBe(3600000);
  });

  it.each([
    '../other',
    '/tmp/elsewhere',
    '',
    'abc',
    'f07fe294-9455-4f63-bb19-37c1eff2fc2a/../../x',
  ])('rejects unsafe session ID %s', (id) => {
    expect(() => sessionDirectory(id)).toThrow();
  });
});
