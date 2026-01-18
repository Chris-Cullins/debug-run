/**
 * Tests for OutputFormatter compact mode
 */

import { describe, it, expect } from 'vitest';
import { OutputFormatter } from './formatter.js';
import { Writable } from 'stream';
import type { BreakpointHitEvent, StackFrameInfo, VariableValue } from './events.js';

// Helper to capture output
function createCaptureStream(): { stream: Writable; getOutput: () => string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      const text = chunk.toString();
      // Split by newlines and filter empty
      lines.push(...text.split('\n').filter((l: string) => l.trim()));
      callback();
    },
  });
  return { stream, getOutput: () => lines };
}

describe('OutputFormatter compact mode', () => {
  describe('stack trace limiting', () => {
    it('limits stack frames to 3 by default in compact mode', () => {
      const { stream, getOutput } = createCaptureStream();
      const formatter = new OutputFormatter({ stream, compact: true });

      const stackTrace: StackFrameInfo[] = [
        { frameId: 1, function: 'processOrder', file: '/app/src/order.ts', line: 45 },
        { frameId: 2, function: 'handleRequest', file: '/app/src/handler.ts', line: 20 },
        { frameId: 3, function: 'routeRequest', file: '/app/src/router.ts', line: 10 },
        { frameId: 4, function: 'main', file: '/app/src/index.ts', line: 5 },
        { frameId: 5, function: 'bootstrap', file: '/app/src/bootstrap.ts', line: 1 },
      ];

      const event: BreakpointHitEvent = {
        type: 'breakpoint_hit',
        timestamp: '2025-01-15T10:00:00Z',
        threadId: 1,
        location: { file: '/app/src/order.ts', line: 45, function: 'processOrder' },
        stackTrace,
        locals: {},
      };

      formatter.emit(event);

      const output = getOutput();
      expect(output.length).toBe(1);
      const parsed = JSON.parse(output[0]) as BreakpointHitEvent;
      expect(parsed.stackTrace.length).toBe(3);
    });

    it('respects custom stackLimit option', () => {
      const { stream, getOutput } = createCaptureStream();
      const formatter = new OutputFormatter({ stream, compact: true, stackLimit: 5 });

      const stackTrace: StackFrameInfo[] = Array.from({ length: 10 }, (_, i) => ({
        frameId: i + 1,
        function: `func${i}`,
        file: `/app/src/file${i}.ts`,
        line: i * 10,
      }));

      const event: BreakpointHitEvent = {
        type: 'breakpoint_hit',
        timestamp: '2025-01-15T10:00:00Z',
        threadId: 1,
        location: { file: '/app/src/file0.ts', line: 0, function: 'func0' },
        stackTrace,
        locals: {},
      };

      formatter.emit(event);

      const output = getOutput();
      const parsed = JSON.parse(output[0]) as BreakpointHitEvent;
      expect(parsed.stackTrace.length).toBe(5);
    });
  });

  describe('internal frame filtering', () => {
    it('filters out node_modules frames', () => {
      const { stream, getOutput } = createCaptureStream();
      const formatter = new OutputFormatter({ stream, compact: true, stackLimit: 10 });

      const stackTrace: StackFrameInfo[] = [
        { frameId: 1, function: 'processOrder', file: '/app/src/order.ts', line: 45 },
        {
          frameId: 2,
          function: 'runMiddleware',
          file: '/app/node_modules/express/lib/router.js',
          line: 100,
        },
        { frameId: 3, function: 'handleRequest', file: '/app/src/handler.ts', line: 20 },
      ];

      const event: BreakpointHitEvent = {
        type: 'breakpoint_hit',
        timestamp: '2025-01-15T10:00:00Z',
        threadId: 1,
        location: { file: '/app/src/order.ts', line: 45, function: 'processOrder' },
        stackTrace,
        locals: {},
      };

      formatter.emit(event);

      const output = getOutput();
      const parsed = JSON.parse(output[0]) as BreakpointHitEvent;
      // Should filter out the node_modules frame
      expect(parsed.stackTrace.length).toBe(2);
      expect(parsed.stackTrace.every((f) => !f.file?.includes('node_modules'))).toBe(true);
    });

    it('filters out Node.js internal frames', () => {
      const { stream, getOutput } = createCaptureStream();
      const formatter = new OutputFormatter({ stream, compact: true, stackLimit: 10 });

      const stackTrace: StackFrameInfo[] = [
        { frameId: 1, function: 'processOrder', file: '/app/src/order.ts', line: 45 },
        { frameId: 2, function: 'emit', file: 'node:events', line: 100 },
        { frameId: 3, function: 'runCallback', file: 'internal/process/task_queues.js', line: 50 },
        { frameId: 4, function: 'handleRequest', file: '/app/src/handler.ts', line: 20 },
      ];

      const event: BreakpointHitEvent = {
        type: 'breakpoint_hit',
        timestamp: '2025-01-15T10:00:00Z',
        threadId: 1,
        location: { file: '/app/src/order.ts', line: 45, function: 'processOrder' },
        stackTrace,
        locals: {},
      };

      formatter.emit(event);

      const output = getOutput();
      const parsed = JSON.parse(output[0]) as BreakpointHitEvent;
      // Should filter out node: and internal/ frames
      expect(parsed.stackTrace.length).toBe(2);
    });
  });

  describe('path abbreviation', () => {
    it('abbreviates long paths to last 3 segments', () => {
      const { stream, getOutput } = createCaptureStream();
      const formatter = new OutputFormatter({ stream, compact: true });

      const event: BreakpointHitEvent = {
        type: 'breakpoint_hit',
        timestamp: '2025-01-15T10:00:00Z',
        threadId: 1,
        location: {
          file: '/very/long/path/to/my/project/src/services/order/handler.ts',
          line: 45,
          function: 'processOrder',
        },
        stackTrace: [
          {
            frameId: 1,
            function: 'processOrder',
            file: '/very/long/path/to/my/project/src/services/order/handler.ts',
            line: 45,
          },
        ],
        locals: {},
      };

      formatter.emit(event);

      const output = getOutput();
      const parsed = JSON.parse(output[0]) as BreakpointHitEvent;
      expect(parsed.location.file).toBe('.../services/order/handler.ts');
      expect(parsed.stackTrace[0].file).toBe('.../services/order/handler.ts');
    });

    it('abbreviates node_modules paths', () => {
      const { stream, getOutput } = createCaptureStream();
      // Use non-compact to avoid filtering, but with stackLimit to test abbreviation only
      const formatter = new OutputFormatter({ stream, compact: true, stackLimit: 10 });

      const event: BreakpointHitEvent = {
        type: 'breakpoint_hit',
        timestamp: '2025-01-15T10:00:00Z',
        threadId: 1,
        location: {
          file: '/app/node_modules/express/lib/router/index.js',
          line: 45,
          function: 'handle',
        },
        stackTrace: [],
        locals: {},
      };

      formatter.emit(event);

      const output = getOutput();
      const parsed = JSON.parse(output[0]) as BreakpointHitEvent;
      // node_modules paths get abbreviated
      expect(parsed.location.file).toContain('<node_modules>');
    });
  });

  describe('variable diffing', () => {
    it('returns full locals on first breakpoint hit', () => {
      const { stream, getOutput } = createCaptureStream();
      const formatter = new OutputFormatter({ stream, compact: true });

      const locals: Record<string, VariableValue> = {
        order: { type: 'Order', value: { id: 1, total: 100 } },
        customer: { type: 'Customer', value: { name: 'John' } },
      };

      const event: BreakpointHitEvent = {
        type: 'breakpoint_hit',
        timestamp: '2025-01-15T10:00:00Z',
        threadId: 1,
        location: { file: '/app/src/order.ts', line: 45, function: 'processOrder' },
        stackTrace: [
          { frameId: 1, function: 'processOrder', file: '/app/src/order.ts', line: 45 },
        ],
        locals,
      };

      formatter.emit(event);

      const output = getOutput();
      const parsed = JSON.parse(output[0]);
      // First hit should have full locals (not a diff)
      expect(parsed.locals.order).toBeDefined();
      expect(parsed.locals.customer).toBeDefined();
      expect(parsed.locals._diff).toBeUndefined();
    });

    it('returns only changed variables on subsequent hits', () => {
      const { stream, getOutput } = createCaptureStream();
      const formatter = new OutputFormatter({ stream, compact: true });

      // First hit
      const event1: BreakpointHitEvent = {
        type: 'breakpoint_hit',
        timestamp: '2025-01-15T10:00:00Z',
        threadId: 1,
        location: { file: '/app/src/order.ts', line: 45, function: 'processOrder' },
        stackTrace: [
          { frameId: 1, function: 'processOrder', file: '/app/src/order.ts', line: 45 },
        ],
        locals: {
          order: { type: 'Order', value: { id: 1, total: 100 } },
          customer: { type: 'Customer', value: { name: 'John' } },
        },
      };
      formatter.emit(event1);

      // Second hit with changed order.total
      const event2: BreakpointHitEvent = {
        type: 'breakpoint_hit',
        timestamp: '2025-01-15T10:00:01Z',
        threadId: 1,
        location: { file: '/app/src/order.ts', line: 50, function: 'processOrder' },
        stackTrace: [
          { frameId: 1, function: 'processOrder', file: '/app/src/order.ts', line: 50 },
        ],
        locals: {
          order: { type: 'Order', value: { id: 1, total: 150 } }, // Changed!
          customer: { type: 'Customer', value: { name: 'John' } }, // Same
        },
      };
      formatter.emit(event2);

      const output = getOutput();
      const parsed2 = JSON.parse(output[1]);
      // Second hit should have _diff with only changed variable
      expect(parsed2.locals._diff).toBeDefined();
      expect(parsed2.locals._diff.order).toBeDefined();
      expect(parsed2.locals._diff.customer).toBeUndefined();
    });
  });

  describe('non-compact mode', () => {
    it('does not apply transformations when compact is false', () => {
      const { stream, getOutput } = createCaptureStream();
      const formatter = new OutputFormatter({ stream, compact: false });

      const stackTrace: StackFrameInfo[] = Array.from({ length: 10 }, (_, i) => ({
        frameId: i + 1,
        function: `func${i}`,
        file: `/very/long/path/to/project/src/file${i}.ts`,
        line: i * 10,
      }));

      const event: BreakpointHitEvent = {
        type: 'breakpoint_hit',
        timestamp: '2025-01-15T10:00:00Z',
        threadId: 1,
        location: { file: '/very/long/path/to/project/src/file0.ts', line: 0, function: 'func0' },
        stackTrace,
        locals: {},
      };

      formatter.emit(event);

      const output = getOutput();
      const parsed = JSON.parse(output[0]) as BreakpointHitEvent;
      // Should have all 10 frames
      expect(parsed.stackTrace.length).toBe(10);
      // Should have full paths
      expect(parsed.location.file).toBe('/very/long/path/to/project/src/file0.ts');
    });
  });
});
