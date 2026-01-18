/**
 * Unit tests for DebugSession manager
 */

import { describe, it, expect, vi } from 'vitest';
import { DebugSession } from './manager.js';
import type { AdapterConfig } from '../adapters/base.js';
import { OutputFormatter } from '../output/formatter.js';

// Mock adapter config
const mockAdapter: AdapterConfig = {
  id: 'test-adapter',
  name: 'test',
  command: 'test-cmd',
  args: [],
  launchConfig: () => ({}),
  attachConfig: () => ({}),
  detect: async () => null,
  installHint: 'Test adapter',
};

describe('DebugSession', () => {
  describe('session_end emission', () => {
    it('should only emit session_end once even when endSession is called multiple times', () => {
      // Track session_end calls
      const sessionEndCalls: unknown[] = [];
      const mockFormatter = {
        sessionStart: vi.fn(),
        sessionStartAttach: vi.fn(),
        sessionEnd: vi.fn((summary) => {
          sessionEndCalls.push(summary);
        }),
        emit: vi.fn(),
        createEvent: vi.fn((type, data) => ({
          type,
          timestamp: new Date().toISOString(),
          ...data,
        })),
        error: vi.fn(),
        programOutput: vi.fn(),
      } as unknown as OutputFormatter;

      const session = new DebugSession(
        {
          adapter: mockAdapter,
          breakpoints: [],
        },
        mockFormatter
      );

      // Access private method via prototype trick for testing
      // @ts-expect-error accessing private method for testing
      session.startTime = Date.now();

      // Call endSession multiple times (simulating the bug)
      // @ts-expect-error accessing private method for testing
      session.endSession();
      // @ts-expect-error accessing private method for testing
      session.endSession();
      // @ts-expect-error accessing private method for testing
      session.endSession();

      // Should only have been called once
      expect(sessionEndCalls.length).toBe(1);
      expect(mockFormatter.sessionEnd).toHaveBeenCalledTimes(1);
    });

    it('should only emit session_end once when mixing endSession and endSessionWithError', () => {
      const sessionEndCalls: unknown[] = [];
      const mockFormatter = {
        sessionStart: vi.fn(),
        sessionStartAttach: vi.fn(),
        sessionEnd: vi.fn((summary) => {
          sessionEndCalls.push(summary);
        }),
        emit: vi.fn(),
        createEvent: vi.fn((type, data) => ({
          type,
          timestamp: new Date().toISOString(),
          ...data,
        })),
        error: vi.fn(),
        programOutput: vi.fn(),
      } as unknown as OutputFormatter;

      const session = new DebugSession(
        {
          adapter: mockAdapter,
          breakpoints: [],
        },
        mockFormatter
      );

      // @ts-expect-error accessing private method for testing
      session.startTime = Date.now();

      // Mix of calls that could happen in race conditions
      // @ts-expect-error accessing private method for testing
      session.endSession();
      // @ts-expect-error accessing private method for testing
      session.endSessionWithError(new Error('test error'));
      // @ts-expect-error accessing private method for testing
      session.endSession();

      // Should only have been called once
      expect(sessionEndCalls.length).toBe(1);
      expect(mockFormatter.sessionEnd).toHaveBeenCalledTimes(1);
    });
  });
});
